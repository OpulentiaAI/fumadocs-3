import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_APPROVAL_MS = 30 * 60 * 1000;
const STATES = new Set(['in-flight', 'complete', 'unknown', 'stopped']);

export class WorkflowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

export function demand(condition, code) {
  if (!condition) throw new WorkflowError(code);
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const title = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 255 &&
  [...value].every(
    (character) => character.codePointAt(0) > 31 && character.codePointAt(0) !== 127,
  );
const validTime = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d(?:T| )\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value) &&
  Number.isFinite(
    Date.parse(
      value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`,
    ),
  );

export function validateDomain(domain) {
  demand(
    typeof domain === 'string' &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pipedrive\.com$/.test(domain),
    'INVALID_TENANT_DOMAIN',
  );
  return domain;
}

export function validateAdapter(adapter) {
  if (adapter?.kind === 'pipedrive') {
    demand(exactKeys(adapter, ['kind']), 'INVALID_ADAPTER');
    return { kind: 'pipedrive' };
  }
  demand(
    exactKeys(adapter, ['kind', 'host', 'workspaceRef', 'connectedDomain', 'responseContract']),
    'INVALID_ADAPTER',
  );
  demand(
    adapter.kind === 'deepline' && adapter.host === 'https://code.deepline.com',
    'DEEPLINE_HOST_NOT_ALLOWED',
  );
  demand(
    typeof adapter.workspaceRef === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(adapter.workspaceRef),
    'INVALID_WORKSPACE_REFERENCE',
  );
  validateDomain(adapter.connectedDomain);
  demand(adapter.responseContract === 'toolResponse.raw.data', 'DEEPLINE_CONTRACT_NOT_PINNED');
  return { ...adapter };
}

export function validateRecord(record, id) {
  demand(
    object(record) && Number.isSafeInteger(record.id) && record.id > 0 && record.id === id,
    'RECORD_ID_MISMATCH',
  );
  demand(title(record.title) && validTime(record.update_time), 'MALFORMED_RECORD');
  demand(
    record.is_deleted !== true && record.is_archived !== true && record.status !== 'deleted',
    'RECORD_NOT_ACTIVE',
  );
  return { id: record.id, title: record.title, update_time: record.update_time };
}

export function createPlan({ domain, record, fields, adapter = { kind: 'pipedrive' } }) {
  validateDomain(domain);
  const config = validateAdapter(adapter);
  demand(
    config.kind !== 'deepline' || config.connectedDomain === domain,
    'TENANT_BINDING_MISMATCH',
  );
  demand(exactKeys(fields, ['title']) && title(fields.title), 'FIELD_NOT_ALLOWED');
  const current = validateRecord(record, record?.id);
  demand(current.title !== fields.title, 'NO_CHANGE');
  const body = {
    version: 1,
    operation: 'update-existing-deal-title',
    domain,
    adapter: config,
    recordId: current.id,
    expected: { titleHash: digest(current.title), updateTime: current.update_time },
    fields: { title: fields.title },
  };
  return { ...body, digest: digest(body) };
}

export function validatePlan(plan) {
  demand(
    exactKeys(plan, [
      'version',
      'operation',
      'domain',
      'adapter',
      'recordId',
      'expected',
      'fields',
      'digest',
    ]),
    'INVALID_PLAN',
  );
  const { digest: planDigest, ...body } = plan;
  demand(planDigest === digest(body), 'PLAN_DIGEST_MISMATCH');
  demand(plan.version === 1 && plan.operation === 'update-existing-deal-title', 'INVALID_PLAN');
  validateDomain(plan.domain);
  const adapter = validateAdapter(plan.adapter);
  demand(
    adapter.kind !== 'deepline' || adapter.connectedDomain === plan.domain,
    'TENANT_BINDING_MISMATCH',
  );
  demand(Number.isSafeInteger(plan.recordId) && plan.recordId > 0, 'INVALID_RECORD_ID');
  demand(
    exactKeys(plan.expected, ['titleHash', 'updateTime']) &&
      /^[0-9a-f]{64}$/.test(plan.expected.titleHash) &&
      validTime(plan.expected.updateTime),
    'INVALID_SNAPSHOT',
  );
  demand(exactKeys(plan.fields, ['title']) && title(plan.fields.title), 'FIELD_NOT_ALLOWED');
  return plan;
}

export function approvePlan(
  plan,
  { confirmedDigest, approvedDomain, ttlSeconds = 600, now = Date.now() },
) {
  validatePlan(plan);
  demand(confirmedDigest === plan.digest && approvedDomain === plan.domain, 'APPROVAL_MISMATCH');
  demand(
    Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 1 && ttlSeconds * 1000 <= MAX_APPROVAL_MS,
    'INVALID_APPROVAL_TTL',
  );
  return {
    version: 1,
    planDigest: plan.digest,
    domain: plan.domain,
    approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
}

export function validateApproval(plan, approval, approvedDomain, now = Date.now()) {
  validatePlan(plan);
  demand(
    exactKeys(approval, ['version', 'planDigest', 'domain', 'approvedAt', 'expiresAt']),
    'INVALID_APPROVAL',
  );
  demand(
    approval.version === 1 &&
      approval.planDigest === plan.digest &&
      approval.domain === plan.domain &&
      approvedDomain === plan.domain,
    'APPROVAL_MISMATCH',
  );
  const start = Date.parse(approval.approvedAt);
  const end = Date.parse(approval.expiresAt);
  demand(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      start <= now &&
      end > start &&
      end - start <= MAX_APPROVAL_MS,
    'INVALID_APPROVAL_TIME',
  );
  demand(now < end, 'APPROVAL_EXPIRED');
}

export function receipt(plan, status) {
  return {
    version: 1,
    operationDigest: plan.digest,
    targetHash: digest({ domain: plan.domain, recordId: plan.recordId }),
    adapter: plan.adapter.kind,
    fields: ['title'],
    status,
  };
}

async function syncDirectory(path) {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function appendJournal(path, entry) {
  const file = await open(path, 'a', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(entry)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function applyPlan({
  plan,
  approval,
  approvedDomain,
  stateDir,
  adapter,
  now = () => Date.now(),
}) {
  validateApproval(plan, approval, approvedDomain, now());
  demand(typeof stateDir === 'string' && stateDir.length > 0, 'STATE_DIRECTORY_REQUIRED');
  demand(
    adapter &&
      canonical(adapter.config) === canonical(plan.adapter) &&
      adapter.domain === plan.domain,
    'ADAPTER_MISMATCH',
  );
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(stateDir);
  demand(
    directoryInfo.isDirectory() &&
      !directoryInfo.isSymbolicLink() &&
      (directoryInfo.mode & 0o077) === 0,
    'UNSAFE_STATE_DIRECTORY',
  );
  const lockPath = join(stateDir, 'workflow.lock');
  const journalPath = join(stateDir, 'journal.jsonl');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new WorkflowError('JOURNAL_LOCKED');
  }
  try {
    await lock.writeFile('locked\n');
    await lock.sync();
    await syncDirectory(stateDir);
    let history = '';
    try {
      const info = await lstat(journalPath);
      demand(
        info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0,
        'UNSAFE_JOURNAL',
      );
      history = await readFile(journalPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new WorkflowError('JOURNAL_UNREADABLE');
    }
    let entries;
    try {
      entries = history.trim()
        ? history
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [];
      demand(
        entries.every(
          (entry) =>
            exactKeys(entry, [
              'version',
              'operationDigest',
              'targetHash',
              'adapter',
              'fields',
              'status',
            ]) &&
            entry.version === 1 &&
            /^[0-9a-f]{64}$/.test(entry.operationDigest) &&
            /^[0-9a-f]{64}$/.test(entry.targetHash) &&
            ['pipedrive', 'deepline'].includes(entry.adapter) &&
            canonical(entry.fields) === '["title"]' &&
            STATES.has(entry.status),
        ),
        'JOURNAL_CORRUPT',
      );
    } catch {
      throw new WorkflowError('JOURNAL_CORRUPT');
    }
    const previous = entries.filter((entry) => entry.operationDigest === plan.digest).at(-1);
    if (previous?.status === 'complete') return receipt(plan, 'already-complete');
    demand(!previous, 'REPLAY_REQUIRES_RECONCILIATION');
    const latestByOperation = new Map(entries.map((entry) => [entry.operationDigest, entry]));
    const targetHash = receipt(plan, 'in-flight').targetHash;
    demand(
      ![...latestByOperation.values()].some(
        (entry) => entry.targetHash === targetHash && entry.status !== 'complete',
      ),
      'TARGET_REQUIRES_RECONCILIATION',
    );
    const current = validateRecord(await adapter.read(plan.recordId), plan.recordId);
    demand(
      current.update_time === plan.expected.updateTime &&
        digest(current.title) === plan.expected.titleHash,
      'STALE_RECORD',
    );
    validateApproval(plan, approval, approvedDomain, now());
    await appendJournal(journalPath, receipt(plan, 'in-flight'));
    await syncDirectory(stateDir);
    let result;
    let writeAccepted = false;
    try {
      validateApproval(plan, approval, approvedDomain, now());
      const updated = validateRecord(
        await adapter.update(plan.recordId, plan.fields),
        plan.recordId,
      );
      writeAccepted = true;
      demand(updated.title === plan.fields.title, 'WRITE_VERIFICATION_FAILED');
      const verified = validateRecord(await adapter.read(plan.recordId), plan.recordId);
      demand(verified.title === plan.fields.title, 'READBACK_MISMATCH');
      result = receipt(plan, 'complete');
      await appendJournal(journalPath, result);
      return result;
    } catch (error) {
      const status =
        !writeAccepted &&
        error instanceof WorkflowError &&
        ['HTTP_401', 'HTTP_403', 'HTTP_429'].includes(error.code)
          ? 'stopped'
          : 'unknown';
      await appendJournal(journalPath, receipt(plan, status));
      throw new WorkflowError(
        status === 'unknown' ? 'OUTCOME_UNKNOWN_RECONCILE_NO_RETRY' : error.code,
      );
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
    await syncDirectory(stateDir);
  }
}
