export interface ResearchGateInput {
  draft_gate: string;
  identity_state: string;
  relationship_path: string | null;
  accountable_owner: string | null;
  next_action: string | null;
  source_evidence: { source: string; observed_at: string }[];
  exclusion_check: string;
  participation_confirmed: boolean;
}

export function researchGates(research: ResearchGateInput) {
  const reasons = [];
  if (research.draft_gate !== 'open') reasons.push('An owner decision is still required.');
  if (research.identity_state !== 'verified') reasons.push('Business identity is not verified.');
  if (research.exclusion_check !== 'cleared') reasons.push('Restrictions have not been cleared.');
  if (!research.relationship_path) reasons.push('No evidenced relationship path is recorded.');
  if (!research.accountable_owner) reasons.push('No accountable owner is assigned.');
  if (!research.next_action) reasons.push('The next action is not recorded.');
  if (
    !research.source_evidence.length ||
    research.source_evidence.some(
      (evidence) => !evidence.source || !Number.isFinite(Date.parse(evidence.observed_at)),
    )
  )
    reasons.push('Dated source evidence is missing.');
  return {
    researchAllowed: research.draft_gate === 'open',
    reviewReady: reasons.length === 0,
    publicNamingAllowed: reasons.length === 0 && research.participation_confirmed,
    crmWriteAuthorised: false,
    outreachAuthorised: false,
    reasons,
  };
}
