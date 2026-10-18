import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageRoute, validateContent } from '../scripts/content.mjs';

const root = fileURLToPath(new URL('../content/docs', import.meta.url));
const emptyInventory = { guides: [], expectedGuideCount: 0 };

function fixture(t, pages, navigation = '') {
  const directory = mkdtempSync(path.join(tmpdir(), 'hubspot-content-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const docs = path.join(directory, 'docs');
  for (const [name, body] of Object.entries(pages)) {
    const file = path.join(docs, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `---\ntitle: Fixture\ndescription: Regression fixture\n---\n\n${body}`);
  }
  const navigationFiles = [];
  if (navigation) {
    const file = path.join(directory, 'overview.tsx');
    writeFileSync(file, navigation);
    navigationFiles.push(file);
  }
  return validateContent(docs, emptyInventory, { navigationFiles });
}

test('index and nested routes resolve predictably', () => {
  assert.equal(pageRoute(`${root}/index.mdx`, root), '/docs');
  assert.equal(pageRoute(`${root}/best-practices/index.mdx`, root), '/docs/best-practices');
  assert.equal(pageRoute(`${root}/best-practices/email.mdx`, root), '/docs/best-practices/email');
});

test('every document link, navigation entry and source guide has a target', () => {
  const inventory = JSON.parse(
    readFileSync(new URL('../data/deepline-guides.json', import.meta.url), 'utf8'),
  );
  const result = validateContent(root, inventory);
  assert.equal(result.guides, 39);
  assert.ok(result.pages > result.guides);
  assert.deepEqual(result.errors, []);
});

test('duplicate page routes identify both conflicting files', (t) => {
  const result = fixture(t, { 'index.mdx': '', 'same.mdx': '', 'same/index.md': '' });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Duplicate page route \/docs\/same:/);
  assert.match(result.errors[0], /same\.mdx/);
  assert.match(result.errors[0], /same[/\\]index\.md/);
});

for (const [name, body, expected] of [
  ['root-relative Markdown', '[Missing](/docs/absent)', 'broken link'],
  ['relative Markdown', '[Missing](./absent)', 'broken link'],
  ['parent-relative Markdown', '[Missing](../absent)', 'broken link'],
  ['reference Markdown', '[Missing][target]\n\n[target]: /docs/absent', 'broken link'],
  ['collapsed reference Markdown', '[missing][]\n\n[missing]: /docs/absent', 'broken link'],
  ['shortcut reference Markdown', '[target]\n\n[target]: /docs/absent', 'broken link'],
  ['undefined reference', '[Missing][undefined]', 'missing link reference'],
  ['literal JSX href', '<a href="/docs/absent">Missing</a>', 'broken link'],
  ['JSX literal-expression href', '<Link href={"/docs/absent"}>Missing</Link>', 'broken link'],
  ['single-quoted JSX expression', "<Link href={ '/docs/absent' }>Missing</Link>", 'broken link'],
  ['same-page fragment', '[Missing](#absent)', 'broken anchor'],
  ['cross-page fragment', '[Missing](/docs#absent)', 'broken anchor'],
  ['query and fragment', '[Missing](/docs?view=full#absent)', 'broken anchor'],
]) {
  test(`rejects a broken ${name} target`, (t) => {
    const result = fixture(t, { 'index.mdx': '## Present', 'nested/page.mdx': body });
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes(expected), result.errors[0]);
  });
}

test('valid relative, reference and JSX links accept native Fumadocs heading IDs', (t) => {
  const result = fixture(t, {
    'index.mdx':
      '## Hello **world**!\n\n## Hello world!\n\n## Custom [#chosen]\n\nSetext heading\n--------------',
    'nested/page.mdx': [
      '[Relative](../#hello-world)',
      '[Duplicate](/docs#hello-world-1)',
      '[Custom][target]',
      '[target]: /docs?view=full#chosen',
      '[Setext](/docs#setext-heading)',
      '<Link href={"/docs#hello-world"}>Heading</Link>',
      '[External](https://example.com/missing#missing)',
      '[Email](mailto:example@example.com)',
    ].join('\n\n'),
  });
  assert.deepEqual(result.errors, []);
});

test('code examples do not create links or heading anchors', (t) => {
  const result = fixture(t, {
    'index.mdx': [
      '`[Missing](/docs/absent)`',
      '```md',
      '## Not a heading',
      '[Missing](/docs/absent)',
      '```',
      '~~~tsx',
      '<Link href={"/docs/absent"}>Example</Link>',
      '~~~',
      '[Missing anchor](#not-a-heading)',
    ].join('\n\n'),
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /broken anchor #not-a-heading/);
});

test('overview card data and JSX navigation targets are checked', (t) => {
  const result = fixture(
    t,
    { 'index.mdx': '## Present' },
    [
      "const cards = [{ href: '/docs/absent-card' }];",
      '<Link href={"/docs/absent-link"}>Missing</Link>',
      '<Link href="/docs#absent">Missing anchor</Link>',
      "const valid = { href: '/docs#present' };",
    ].join('\n'),
  );
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some((error) => error.includes('broken link /docs/absent-card')));
  assert.ok(result.errors.some((error) => error.includes('broken link /docs/absent-link')));
  assert.ok(result.errors.some((error) => error.includes('broken anchor /docs#absent')));
});

test('missing navigation entries remain validation errors', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hubspot-navigation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'index.mdx'), '---\ntitle: Home\ndescription: Home\n---\n');
  writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ pages: ['absent'] }));
  const result = validateContent(directory, emptyInventory, { navigationFiles: [] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /missing navigation page absent/);
});
