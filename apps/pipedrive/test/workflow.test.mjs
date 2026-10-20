import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  approvePlan,
  applyPlan as executePlan,
  createPlan,
  digest,
  receipt,
  WorkflowError,
} from '../integration/workflow.mjs';
import { deeplineAdapter, pipedriveAdapter } from '../integration/adapters.mjs';

const now = Date.parse('2026-10-20T00:00:00Z');
const domain = 'example-team.pipedrive.com';
const record = { id: 101, title: 'Synthetic enquiry', update_time: '2026-10-19T00:00:00Z' };
const input = {
  domain,
  record,
  fields: { title: 'Synthetic enquiry reviewed' },
  adapter: { kind: 'pipedrive' },
};
const plan = () => createPlan(input);
const approval = (p) => approvePlan(p, { confirmedDigest: p.digest, approvedDomain: domain, now });
const code = (value) => (error) => error.code === value;
const applyPlan = (p, a, { journalPath, now: clock = now, ...options }) =>
  executePlan({
    plan: p,
    approval: a,
    ...options,
    stateDir: dirname(journalPath),
    now: () => clock,
  });

async function context(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pipedrive-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, 'journal.jsonl');
  return { directory, journalPath };
}

function mock(config = input.adapter) {
  let current = structuredClone(record);
  const calls = [];
  return {
    domain,
    config,
    calls,
    read: async (id) => {
      calls.push(['read', id]);
      return structuredClone(current);
    },
    update: async (id, fields) => {
      calls.push(['update', id, fields]);
      current = { ...current, ...fields, update_time: '2026-10-20T00:00:01Z' };
      return structuredClone(current);
    },
  };
}

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const wrapped = (data) => ({ toolResponse: { raw: { data: { success: true, data } } } });

test('deterministic offline plan and demo do not access fetch or credentials', () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('NETWORK_FORBIDDEN');
  };
  try {
    assert.deepEqual(plan(), plan());
    assert.equal(plan().operation, 'update-existing-deal-title');
    assert.equal(approval(plan()).planDigest, plan().digest);
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN')};const {main}=await import('./scripts/workflow.mjs');await main(['demo'])",
      ],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).networkCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects unknown fields, unsafe tenant URLs and invalid records', () => {
  for (const fields of [
    { title: 'ok', status: 'won' },
    { status: 'won' },
    { title: '' },
    { title: null },
  ])
    assert.throws(() => createPlan({ ...input, fields }));
  for (const bad of [
    'https://example.pipedrive.com',
    'example.pipedrive.com.evil.test',
    'EXAMPLE.pipedrive.com',
    'example.pipedrive.com:443',
    'a.b.pipedrive.com',
  ])
    assert.throws(() => createPlan({ ...input, domain: bad }));
  assert.throws(() => createPlan({ ...input, record: { ...record, id: '../2' } }));
  assert.throws(() => createPlan({ ...input, record: { ...record, update_time: '' } }));
  assert.throws(() => createPlan({ ...input, fields: { title: record.title } }), code('NO_CHANGE'));
});

test('approval binds payload, tenant, record, adapter, digest and expiry before any calls', async (t) => {
  const { journalPath } = await context(t);
  const p = plan();
  assert.throws(
    () => approvePlan(p, { confirmedDigest: 'wrong', approvedDomain: domain, now }),
    code('APPROVAL_MISMATCH'),
  );
  assert.throws(
    () => approvePlan(p, { confirmedDigest: p.digest, approvedDomain: 'other.pipedrive.com', now }),
    code('APPROVAL_MISMATCH'),
  );
  for (const mutate of [
    (x) => (x.fields.title = 'changed'),
    (x) => (x.domain = 'other.pipedrive.com'),
    (x) => (x.recordId = 102),
    (x) => (x.adapter = { kind: 'bad' }),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    await assert.rejects(
      applyPlan(changed, approval(p), {
        approvedDomain: domain,
        adapter: mock(),
        journalPath,
        now,
      }),
    );
  }
  const adapter = mock();
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now: now + 900000 }),
    code('APPROVAL_EXPIRED'),
  );
  await assert.rejects(
    applyPlan(
      p,
      { ...approval(p), expiresAt: new Date(now + 3600000).toISOString() },
      { approvedDomain: domain, adapter, journalPath, now },
    ),
    code('INVALID_APPROVAL_TIME'),
  );
  await assert.rejects(
    applyPlan(p, approval(p), {
      approvedDomain: domain,
      adapter: { ...adapter, config: { kind: 'deepline' } },
      journalPath,
      now,
    }),
    code('ADAPTER_MISMATCH'),
  );
  assert.equal(adapter.calls.length, 0);
});

test('read-update-read, private minimal receipts and persisted replay across adapter instances', async (t) => {
  const { journalPath } = await context(t);
  const p = plan();
  const adapter = mock();
  const receipt = await applyPlan(p, approval(p), {
    approvedDomain: domain,
    adapter,
    journalPath,
    now,
  });
  assert.equal(receipt.status, 'complete');
  assert.deepEqual(
    adapter.calls.map(([kind]) => kind),
    ['read', 'update', 'read'],
  );
  const again = mock();
  assert.equal(
    (await applyPlan(p, approval(p), { approvedDomain: domain, adapter: again, journalPath, now }))
      .status,
    'already-complete',
  );
  assert.equal(again.calls.length, 0);
  const journal = await readFile(journalPath, 'utf8');
  assert.doesNotMatch(journal, /Synthetic|example-team|pipedrive\.com|x-api-token|authorization/);
  assert.deepEqual(
    journal
      .trim()
      .split('\n')
      .map(JSON.parse)
      .map((entry) => entry.status),
    ['in-flight', 'complete'],
  );
});

test('stale title or update timestamp stops before write', async (t) => {
  const { journalPath } = await context(t);
  for (const changed of [
    { ...record, title: 'someone else changed it' },
    { ...record, update_time: '2026-10-20T00:00:00Z' },
  ]) {
    const adapter = mock();
    adapter.read = async () => changed;
    await assert.rejects(
      applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
      code('STALE_RECORD'),
    );
    assert.equal(adapter.calls.length, 0);
  }
});

test('unknown write outcome prevents same and new plans for the target from retrying', async (t) => {
  const { journalPath } = await context(t);
  const adapter = mock();
  adapter.update = async () => {
    throw new WorkflowError('TRANSPORT_OUTCOME_UNCERTAIN');
  };
  const p = plan();
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now }),
    code('OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'),
  );
  const again = mock();
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter: again, journalPath, now }),
    code('REPLAY_REQUIRES_RECONCILIATION'),
  );
  const next = createPlan({ ...input, fields: { title: 'another reviewed title' } });
  await assert.rejects(
    applyPlan(next, approval(next), { approvedDomain: domain, adapter: again, journalPath, now }),
    code('TARGET_REQUIRES_RECONCILIATION'),
  );
  assert.equal(again.calls.length, 0);
});

test('persistent in-flight marker and journal lock both fail closed', async (t) => {
  const { journalPath } = await context(t);
  const p = plan();
  const adapter = mock();
  await writeFile(join(dirname(journalPath), 'workflow.lock'), '');
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now }),
    code('JOURNAL_LOCKED'),
  );
  await rm(join(dirname(journalPath), 'workflow.lock'));
  await writeFile(journalPath, JSON.stringify(receipt(p, 'in-flight')) + '\n', { mode: 0o600 });
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now }),
    code('REPLAY_REQUIRES_RECONCILIATION'),
  );
  await writeFile(journalPath, '{truncated');
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now }),
    code('JOURNAL_CORRUPT'),
  );
  assert.equal(adapter.calls.length, 0);
});

test('concurrent invocations cannot pass the same journal lock', async (t) => {
  const { journalPath } = await context(t);
  const p = plan();
  const adapter = mock();
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  adapter.read = async () => {
    if (reads++ === 0) {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    return record;
  };
  const first = applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now });
  await started;
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter: mock(), journalPath, now }),
    code('JOURNAL_LOCKED'),
  );
  release();
  await assert.rejects(first, code('OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'));
});

test('readback mismatch is unknown, not success', async (t) => {
  const { journalPath } = await context(t);
  const p = plan();
  const adapter = mock();
  adapter.read = async () => record;
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now }),
    code('OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'),
  );
});

test('REST path, method, token header, body and redirect policy match documented API', async () => {
  const calls = [];
  const adapter = pipedriveAdapter({
    domain,
    token: 'test-only-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ success: true, data: record });
    },
  });
  await adapter.read(101);
  await adapter.update(101, input.fields);
  assert.equal(calls[0].url, `https://${domain}/api/v2/deals/101`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].options.headers['x-api-token'], 'test-only-token');
  assert.equal(calls[1].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[1].options.body), input.fields);
});

for (const status of [401, 429, 500]) {
  test(`HTTP ${status} on initial read makes one call, no write or automatic retry`, async (t) => {
    const { journalPath } = await context(t);
    let calls = 0;
    const adapter = pipedriveAdapter({
      domain,
      token: 'test-only-token',
      fetchImpl: async () => {
        calls++;
        return response({ error: 'sensitive-body-not-logged' }, status);
      },
    });
    await assert.rejects(
      applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
    );
    assert.equal(calls, 1);
  });
  test(`HTTP ${status} during write persists unknown and stops replay`, async (t) => {
    const { journalPath } = await context(t);
    let calls = 0;
    const adapter = pipedriveAdapter({
      domain,
      token: 'test-only-token',
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? response({ success: true, data: record }) : response({}, status);
      },
    });
    const expected = status === 500 ? 'OUTCOME_UNKNOWN_RECONCILE_NO_RETRY' : `HTTP_${status}`;
    await assert.rejects(
      applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
      code(expected),
    );
    await assert.rejects(
      applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
      code('REPLAY_REQUIRES_RECONCILIATION'),
    );
    assert.equal(calls, 2);
  });
}

test('malformed JSON and success:false envelopes cannot become successful reads', async () => {
  for (const body of [
    response({ success: false, data: record }),
    response({ success: true, error: 'failure', data: record }),
    new Response('<html>broken</html>'),
  ]) {
    await assert.rejects(
      pipedriveAdapter({ domain, token: 'test-only-token', fetchImpl: async () => body }).read(101),
    );
  }
});

const config = {
  kind: 'deepline',
  host: 'https://code.deepline.com',
  workspaceRef: 'dedicated-workspace-review-ref',
  connectedDomain: domain,
  responseContract: 'toolResponse.raw.data',
};
function deepline(fetchImpl) {
  return deeplineAdapter({
    config,
    approvedHost: config.host,
    approvedWorkspace: config.workspaceRef,
    token: 'test-only-key',
    fetchImpl,
  });
}

test('Deepline HTTP uses only allowlisted tools, payload wrapper and pinned nested envelope', async () => {
  const calls = [];
  const adapter = deepline(async (url, options) => {
    calls.push({ url, options });
    return response(wrapped(record));
  });
  assert.deepEqual(await adapter.read(101), record);
  await adapter.update(101, input.fields);
  assert.equal(calls[0].url, `${config.host}/api/v2/integrations/pipedrive_get_deal/execute`);
  assert.equal(calls[1].url, `${config.host}/api/v2/integrations/pipedrive_update_deal/execute`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { payload: { id: 101, ...input.fields } });
  assert.equal(calls[1].options.headers.authorization, 'Bearer test-only-key');
  assert.throws(() =>
    deeplineAdapter({
      config,
      approvedHost: 'https://evil.test',
      approvedWorkspace: config.workspaceRef,
      token: 'test',
    }),
  );
  assert.throws(() =>
    createPlan({ ...input, adapter: { ...config, host: 'http://code.deepline.com' } }),
  );
  assert.throws(() =>
    createPlan({ ...input, adapter: { ...config, host: 'https://code.deepline.com/path' } }),
  );
});

test('Deepline malformed, changed and nested failure envelopes all fail closed', async () => {
  for (const body of [
    { success: false, ...wrapped(record) },
    { toolResponse: { raw: { data: { success: false, data: record } } } },
    { toolResponse: { rawV2: { data: { success: true, data: record } } } },
    { toolResponse: { raw: { success: false, data: { success: true, data: record } } } },
    { toolResponse: { raw: { data: { data: record } } } },
  ]) {
    await assert.rejects(deepline(async () => response(body)).read(101));
  }
});

test('Deepline uses the same approval, stale detection, journal and readback workflow', async (t) => {
  const { journalPath } = await context(t);
  const p = createPlan({ ...input, adapter: config });
  let current = structuredClone(record);
  let calls = 0;
  const adapter = deepline(async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body).payload;
    if (payload.title)
      current = { ...current, title: payload.title, update_time: '2026-10-20T00:00:00Z' };
    return response(wrapped(current));
  });
  assert.equal(
    (await applyPlan(p, approval(p), { approvedDomain: domain, adapter, journalPath, now })).status,
    'complete',
  );
  assert.equal(calls, 3);
});

test('CLI plan, approve and dry-run complete without credentials or network', async (t) => {
  const { directory } = await context(t);
  const inputPath = join(directory, 'input.json');
  const planPath = join(directory, 'plan.json');
  const approvalPath = join(directory, 'approval.json');
  await writeFile(inputPath, JSON.stringify(input));
  const { main } = await import('../scripts/workflow.mjs');
  const outputs = [];
  const options = {
    env: {},
    fetchImpl: () => {
      throw new Error('NETWORK_FORBIDDEN');
    },
    output: (value) => outputs.push(JSON.parse(value)),
  };
  await main(['plan', '--input', inputPath, '--out', planPath], options);
  const generated = JSON.parse(await readFile(planPath, 'utf8'));
  await main(
    [
      'approve',
      '--plan',
      planPath,
      '--confirm',
      generated.digest,
      '--approved-domain',
      domain,
      '--out',
      approvalPath,
    ],
    options,
  );
  await main(
    ['dry-run', '--plan', planPath, '--approval', approvalPath, '--approved-domain', domain],
    options,
  );
  assert.equal(outputs.at(-1).networkCalls, 0);
  assert.equal(outputs.at(-1).status, 'dry-run');
  await assert.rejects(
    main(
      [
        'apply',
        '--plan',
        planPath,
        '--approval',
        approvalPath,
        '--approved-domain',
        domain,
        '--state-dir',
        directory,
      ],
      options,
    ),
    code('LIVE_FLAG_REQUIRED'),
  );
  await assert.rejects(
    main(['plan', '--input', inputPath, '--out', planPath], options),
    code('OUTPUT_EXISTS_OR_UNWRITABLE'),
  );
});

test('approval that expires during initial read never dispatches an update', async (t) => {
  const { directory } = await context(t);
  const p = plan();
  const adapter = mock();
  let clock = now;
  adapter.read = async () => {
    clock += 900000;
    return record;
  };
  await assert.rejects(
    executePlan({
      plan: p,
      approval: approval(p),
      approvedDomain: domain,
      stateDir: directory,
      adapter,
      now: () => clock,
    }),
    code('APPROVAL_EXPIRED'),
  );
  assert.equal(adapter.calls.length, 0);
});

test('state directory and journal refuse broad permissions', async (t) => {
  const { directory, journalPath } = await context(t);
  const p = plan();
  const adapter = mock();
  await chmod(directory, 0o755);
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, journalPath, adapter, now }),
    code('UNSAFE_STATE_DIRECTORY'),
  );
  await chmod(directory, 0o700);
  await writeFile(journalPath, '', { mode: 0o644 });
  await assert.rejects(
    applyPlan(p, approval(p), { approvedDomain: domain, journalPath, adapter, now }),
    code('JOURNAL_UNREADABLE'),
  );
  assert.equal(adapter.calls.length, 0);
});

test('adapters reject forbidden IDs and fields even outside the runner', async () => {
  let calls = 0;
  for (const adapter of [
    pipedriveAdapter({
      domain,
      token: 'test',
      fetchImpl: async () => {
        calls++;
      },
    }),
    deepline(async () => {
      calls++;
    }),
  ]) {
    await assert.rejects(adapter.read('../2'), code('INVALID_RECORD_ID'));
    await assert.rejects(
      adapter.update(101, { title: 'title', status: 'won' }),
      code('FIELD_NOT_ALLOWED'),
    );
  }
  assert.equal(calls, 0);
});

test('wrong adapter tenant is rejected before network, even for direct REST', async (t) => {
  const { journalPath } = await context(t);
  const adapter = mock();
  adapter.domain = 'another.pipedrive.com';
  await assert.rejects(
    applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
    code('ADAPTER_MISMATCH'),
  );
  assert.equal(adapter.calls.length, 0);
});

test('readback auth failure after an accepted update remains an unknown outcome', async (t) => {
  const { journalPath } = await context(t);
  let reads = 0;
  const adapter = mock();
  adapter.read = async () => {
    if (reads++ === 0) return record;
    throw new WorkflowError('HTTP_401');
  };
  await assert.rejects(
    applyPlan(plan(), approval(plan()), { approvedDomain: domain, adapter, journalPath, now }),
    code('OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'),
  );
  const entries = (await readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(entries.at(-1).status, 'unknown');
});

test('expiry at final dispatch check after journal sync prevents update', async (t) => {
  const { directory, journalPath } = await context(t);
  const p = plan();
  const a = approval(p);
  const adapter = mock();
  let clockReads = 0;
  await assert.rejects(
    executePlan({
      plan: p,
      approval: a,
      approvedDomain: domain,
      stateDir: directory,
      adapter,
      now: () => (++clockReads >= 3 ? now + 601000 : now),
    }),
    code('OUTCOME_UNKNOWN_RECONCILE_NO_RETRY'),
  );
  assert.deepEqual(adapter.calls, [['read', 101]]);
  const entries = (await readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(entries.at(-1).status, 'unknown');
});

test('plan digest is canonical and extra metadata cannot bypass approval', () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const p = plan();
  p.unapproved = true;
  assert.throws(() => approval(p), code('INVALID_PLAN'));
});
