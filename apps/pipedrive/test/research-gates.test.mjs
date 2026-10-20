import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchGates } from '../lib/research-gates.ts';

const ready = {
  draft_gate: 'open',
  identity_state: 'verified',
  relationship_path: 'Public advisory relationship, verified source',
  accountable_owner: 'Synthetic account owner',
  next_action: 'Review the internal brief',
  source_evidence: [
    { source: 'https://example.com/evidence', observed_at: '2026-10-20T00:00:00Z' },
  ],
  exclusion_check: 'cleared',
  participation_confirmed: false,
};

test('review readiness grants neither CRM writes, outreach nor public naming', () => {
  const result = researchGates(ready);
  assert.equal(result.reviewReady, true);
  assert.equal(result.crmWriteAuthorised, false);
  assert.equal(result.outreachAuthorised, false);
  assert.equal(result.publicNamingAllowed, false);
});

test('missing evidence, identity, owner, relationship and next action each block promotion', () => {
  for (const patch of [
    { source_evidence: [] },
    { source_evidence: [{ source: 'https://example.com', observed_at: 'not-a-date' }] },
    { identity_state: 'synthetic' },
    { accountable_owner: null },
    { relationship_path: null },
    { next_action: null },
    { exclusion_check: 'unverified_against_rule' },
  ]) {
    const result = researchGates({ ...ready, ...patch, participation_confirmed: true });
    assert.equal(result.reviewReady, false);
    assert.equal(result.publicNamingAllowed, false);
    assert.ok(result.reasons.length);
  }
});

test('a restriction or owner hold overrides otherwise complete evidence', () => {
  const result = researchGates({
    ...ready,
    draft_gate: 'blocked_client_decision',
    participation_confirmed: true,
  });
  assert.equal(result.researchAllowed, false);
  assert.equal(result.reviewReady, false);
  assert.equal(result.publicNamingAllowed, false);
});

test('confirmed participation is separately required even when evidence is complete', () => {
  const result = researchGates({ ...ready, participation_confirmed: true });
  assert.equal(result.publicNamingAllowed, true);
  assert.equal(result.crmWriteAuthorised, false);
  assert.equal(result.outreachAuthorised, false);
});
