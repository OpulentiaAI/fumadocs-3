import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sponsor-crm.json', import.meta.url), 'utf8'),
);

test('synthetic Pipedrive relationships resolve without real tenant IDs or contact domains', () => {
  const keys = new Set();
  for (const kind of ['organizations', 'persons', 'deals']) {
    for (const record of fixture[kind]) {
      assert.ok(record.fixture_id);
      assert.ok(!keys.has(`${kind}:${record.fixture_id}`));
      keys.add(`${kind}:${record.fixture_id}`);
      assert.equal(record.id, undefined);
      assert.equal(record.properties, undefined);
    }
  }
  for (const record of fixture.organizations) {
    assert.ok(record.name);
    assert.match(record.research.domain, /\.example\.com$/);
    assert.equal(record.research.participation_confirmed, false);
    assert.equal(record.research.relationship_path, null);
    assert.equal(record.research.accountable_owner, null);
    assert.deepEqual(record.research.source_evidence, []);
    assert.ok(record.research.next_action);
  }
  for (const record of fixture.persons) {
    assert.ok(record.name);
    for (const email of record.emails) {
      assert.match(email.value, /@[^@]+\.example\.com$/);
      assert.equal(email.label, 'work');
    }
  }
  for (const record of fixture.deals) {
    assert.equal(typeof record.value, 'number');
    assert.equal(record.currency, 'USD');
    assert.ok(record.title);
    assert.equal(record.mapping.stage_id, null);
  }
  for (const association of fixture.associations) {
    assert.ok(keys.has(association.from));
    assert.ok(keys.has(association.to));
  }
  assert.equal(fixture.import_policy.live_import_authorised, false);
  assert.ok(fixture.organizations.some((company) => company.research.draft_gate !== 'open'));
});

test('light-mode secondary text has sufficient contrast on every muted surface', () => {
  const css = readFileSync(new URL('../app/global.css', import.meta.url), 'utf8').split('.dark')[0];
  const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))[1];
  const luminance = (hex) => {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((channel) => parseInt(channel, 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const foreground = luminance(token('--color-fd-muted-foreground'));
  for (const name of ['--color-fd-muted', '--crm-soft', '--crm-panel']) {
    const background = luminance(token(name));
    const ratio =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(ratio >= 4.5, `${name}: ${ratio}`);
  }
});
