import { demand, validateAdapter, validateDomain, WorkflowError } from './workflow.mjs';

const MAX_RESPONSE_BYTES = 1024 * 1024;

async function requestJson(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new WorkflowError('TRANSPORT_OUTCOME_UNCERTAIN');
  }
  demand(
    response.status === 200,
    [401, 403, 429].includes(response.status)
      ? `HTTP_${response.status}`
      : 'HTTP_RESPONSE_REJECTED',
  );
  let text = '';
  try {
    let size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      demand(size <= MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE');
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    throw new WorkflowError('MALFORMED_RESPONSE');
  }
}

function validateInput(id, fields) {
  demand(Number.isSafeInteger(id) && id > 0, 'INVALID_RECORD_ID');
  if (fields !== undefined)
    demand(
      fields &&
        Object.keys(fields).length === 1 &&
        typeof fields.title === 'string' &&
        fields.title.trim().length > 0 &&
        fields.title.length <= 255 &&
        [...fields.title].every(
          (character) => character.codePointAt(0) > 31 && character.codePointAt(0) !== 127,
        ),
      'FIELD_NOT_ALLOWED',
    );
}

function providerRecord(body) {
  demand(
    body &&
      body.success === true &&
      !body.error &&
      body.data &&
      typeof body.data === 'object' &&
      !Array.isArray(body.data),
    'PROVIDER_RESPONSE_REJECTED',
  );
  return body.data;
}

export function pipedriveAdapter({ domain, token, fetchImpl = globalThis.fetch }) {
  validateDomain(domain);
  demand(
    typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token),
    'PIPEDRIVE_API_TOKEN_REQUIRED',
  );
  const call = async (id, fields) => {
    validateInput(id, fields);
    const body = await requestJson(fetchImpl, `https://${domain}/api/v2/deals/${id}`, {
      method: fields ? 'PATCH' : 'GET',
      headers: {
        'x-api-token': token,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(fields ? { body: JSON.stringify(fields) } : {}),
    });
    return providerRecord(body);
  };
  return {
    domain,
    config: { kind: 'pipedrive' },
    read: (id) => call(id),
    update: (id, fields) => call(id, fields),
  };
}

export function deeplineAdapter({
  config,
  approvedHost,
  approvedWorkspace,
  token,
  fetchImpl = globalThis.fetch,
}) {
  validateAdapter(config);
  demand(
    config.kind === 'deepline' &&
      approvedHost === config.host &&
      approvedWorkspace === config.workspaceRef,
    'DEEPLINE_BINDING_NOT_CONFIRMED',
  );
  demand(
    typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token),
    'DEEPLINE_API_KEY_REQUIRED',
  );
  const call = async (toolId, input) => {
    demand(['pipedrive_get_deal', 'pipedrive_update_deal'].includes(toolId), 'TOOL_NOT_ALLOWED');
    const { id, ...fields } = input;
    validateInput(id, toolId === 'pipedrive_update_deal' ? fields : undefined);
    const body = await requestJson(
      fetchImpl,
      `${config.host}/api/v2/integrations/${toolId}/execute`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ payload: input }),
      },
    );
    demand(
      body &&
        body.success !== false &&
        !body.error &&
        body.toolResponse &&
        body.toolResponse.success !== false &&
        !body.toolResponse.error,
      'DEEPLINE_RESPONSE_REJECTED',
    );
    demand(body.toolResponse.raw && !body.toolResponse.rawV2, 'DEEPLINE_CONTRACT_CHANGED');
    demand(
      !body.toolResponse.raw.error && body.toolResponse.raw.success !== false,
      'DEEPLINE_RESPONSE_REJECTED',
    );
    return providerRecord(body.toolResponse.raw.data);
  };
  return {
    domain: config.connectedDomain,
    config,
    read: (id) => call('pipedrive_get_deal', { id }),
    update: (id, fields) => call('pipedrive_update_deal', { id, ...fields }),
  };
}
