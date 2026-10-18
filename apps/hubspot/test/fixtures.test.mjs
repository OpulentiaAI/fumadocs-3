import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sponsor-crm.json', import.meta.url), 'utf8'),
);

test('synthetic CRM relationships resolve without real portal IDs or contact domains', () => {
  const keys = new Set();
  for (const kind of ['companies', 'contacts', 'deals']) {
    for (const record of fixture[kind]) {
      assert.ok(record.fixture_id);
      assert.ok(!keys.has(`${kind}:${record.fixture_id}`));
      keys.add(`${kind}:${record.fixture_id}`);
      assert.equal(record.id, undefined);
    }
  }
  for (const record of fixture.companies) assert.match(record.properties.domain, /\.example\.com$/);
  for (const record of fixture.contacts)
    assert.match(record.properties.email, /@[^@]+\.example\.com$/);
  for (const association of fixture.associations) {
    assert.ok(keys.has(association.from));
    assert.ok(keys.has(association.to));
  }
  assert.equal(fixture.import_policy.live_import_authorised, false);
  assert.ok(fixture.companies.some((company) => company.research.draft_gate !== 'open'));
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
  for (const name of ['--color-fd-muted', '--hub-soft', '--hub-panel']) {
    const background = luminance(token(name));
    const ratio =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(ratio >= 4.5, `${name}: ${ratio}`);
  }
});
