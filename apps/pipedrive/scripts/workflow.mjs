import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  approvePlan,
  applyPlan,
  createPlan,
  demand,
  receipt,
  validateApproval,
  WorkflowError,
} from '../integration/workflow.mjs';
import { deeplineAdapter, pipedriveAdapter } from '../integration/adapters.mjs';

const HELP = `Server-only Pipedrive title-update workflow (Node 22+; built-ins only).
Run from apps/pipedrive. No command installs anything.
  node scripts/workflow.mjs demo
  node scripts/workflow.mjs plan --input integration/example-input.json --out /private/plan.json
  node scripts/workflow.mjs approve --plan /private/plan.json --confirm DIGEST --approved-domain COMPANY.pipedrive.com --out /private/approval.json [--ttl-seconds 600]
  node scripts/workflow.mjs dry-run --plan /private/plan.json --approval /private/approval.json --approved-domain COMPANY.pipedrive.com
  node scripts/workflow.mjs apply --plan /private/plan.json --approval /private/approval.json --approved-domain COMPANY.pipedrive.com --state-dir /private/stable-journal --live
For Deepline apply also require --approved-host https://code.deepline.com --approved-workspace WORKSPACE_REFERENCE.
Only apply --live can call the network. Direct apply reads PIPEDRIVE_API_TOKEN; Deepline apply reads DEEPLINE_API_KEY. Never put credentials in arguments or files. Read the reference before live use.`;

function argumentsFor(argv) {
  const [command = 'help', ...args] = argv;
  const flags = {};
  const allowed = {
    help: [],
    demo: [],
    plan: ['input', 'out'],
    approve: ['plan', 'confirm', 'approved-domain', 'out', 'ttl-seconds'],
    'dry-run': ['plan', 'approval', 'approved-domain'],
    apply: [
      'plan',
      'approval',
      'approved-domain',
      'state-dir',
      'live',
      'approved-host',
      'approved-workspace',
    ],
  };
  demand(Object.hasOwn(allowed, command), 'UNKNOWN_COMMAND');
  for (let index = 0; index < args.length; index++) {
    const key = args[index].slice(2);
    demand(
      args[index].startsWith('--') && allowed[command].includes(key) && !Object.hasOwn(flags, key),
      'INVALID_ARGUMENT',
    );
    if (key === 'live') flags[key] = true;
    else {
      demand(args[index + 1] && !args[index + 1].startsWith('--'), 'MISSING_ARGUMENT');
      flags[key] = args[++index];
    }
  }
  return { command, flags };
}

async function load(path) {
  demand(typeof path === 'string' || path instanceof URL, 'FILE_ARGUMENT_REQUIRED');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new WorkflowError('INPUT_FILE_UNREADABLE_OR_INVALID');
  }
}

async function save(path, value) {
  demand(typeof path === 'string', 'OUTPUT_FILE_REQUIRED');
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  let file;
  try {
    file = await open(path, 'wx', 0o600);
  } catch {
    throw new WorkflowError('OUTPUT_EXISTS_OR_UNWRITABLE');
  }
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function main(
  argv = process.argv.slice(2),
  { env = process.env, fetchImpl = globalThis.fetch, output = console.log } = {},
) {
  const { command, flags } = argumentsFor(argv);
  if (command === 'help') return output(HELP);
  if (command === 'demo') {
    const input = await load(new URL('../integration/example-input.json', import.meta.url));
    const plan = createPlan(input);
    const now = Date.parse('2026-01-01T00:00:00Z');
    const approval = approvePlan(plan, {
      confirmedDigest: plan.digest,
      approvedDomain: plan.domain,
      now,
    });
    validateApproval(plan, approval, plan.domain, now);
    output(
      JSON.stringify(
        { mode: 'offline-demo', networkCalls: 0, ...receipt(plan, 'dry-run'), plan, approval },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'plan') {
    const plan = createPlan(await load(flags.input));
    await save(flags.out, plan);
    return output(JSON.stringify({ ...receipt(plan, 'planned'), confirm: plan.digest }));
  }
  const plan = await load(flags.plan);
  if (command === 'approve') {
    const approval = approvePlan(plan, {
      confirmedDigest: flags.confirm,
      approvedDomain: flags['approved-domain'],
      ttlSeconds: flags['ttl-seconds'] === undefined ? 600 : Number(flags['ttl-seconds']),
    });
    await save(flags.out, approval);
    return output(JSON.stringify(receipt(plan, 'approved')));
  }
  const approval = await load(flags.approval);
  validateApproval(plan, approval, flags['approved-domain']);
  if (command === 'dry-run')
    return output(
      JSON.stringify({ mode: 'offline', networkCalls: 0, ...receipt(plan, 'dry-run') }),
    );
  demand(flags.live === true, 'LIVE_FLAG_REQUIRED');
  const adapter =
    plan.adapter.kind === 'pipedrive'
      ? pipedriveAdapter({ domain: plan.domain, token: env.PIPEDRIVE_API_TOKEN, fetchImpl })
      : deeplineAdapter({
          config: plan.adapter,
          approvedHost: flags['approved-host'],
          approvedWorkspace: flags['approved-workspace'],
          token: env.DEEPLINE_API_KEY,
          fetchImpl,
        });
  const result = await applyPlan({
    plan,
    approval,
    approvedDomain: flags['approved-domain'],
    stateDir: flags['state-dir'],
    adapter,
  });
  output(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: 'stopped',
        code: error instanceof WorkflowError ? error.code : 'LOCAL_IO_FAILURE',
      }),
    );
    process.exitCode = 1;
  });
}
