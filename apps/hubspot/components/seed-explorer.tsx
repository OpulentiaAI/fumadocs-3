'use client';

import { useState } from 'react';
import { Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import fixture from '@/fixtures/sponsor-crm.json';

export function SeedExplorer() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const companies = fixture.companies.filter((company) => {
    const matches = `${company.properties.name} ${company.research.category}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return (
      matches &&
      (filter === 'all' ||
        (filter === 'blocked'
          ? company.research.draft_gate !== 'open'
          : company.research.draft_gate === 'open'))
    );
  });
  const current = companies.find((company) => company.fixture_id === selected);
  return (
    <div className="seed-explorer not-prose">
      <div className="seed-notice">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>Offline sandbox · synthetic records · no HubSpot connection or live writes</span>
      </div>
      <div className="seed-controls">
        <label>
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Filter synthetic companies"
            placeholder="Find a company or category…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Filter by review status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All review states</option>
          <option value="open">Research can proceed</option>
          <option value="blocked">Needs a decision</option>
        </select>
      </div>
      <div className="seed-records">
        {companies.length ? (
          companies.map((company) => (
            <button
              type="button"
              key={company.fixture_id}
              onClick={() => setSelected(company.fixture_id)}
              aria-pressed={selected === company.fixture_id}
            >
              <span>
                <strong>{company.properties.name.replace(' (Synthetic)', '')}</strong>
                <small>{company.properties.domain}</small>
              </span>
              <span
                className={company.research.draft_gate === 'open' ? 'state-open' : 'state-held'}
              >
                {company.research.draft_gate === 'open' ? 'Research ready' : 'Decision needed'}
              </span>
            </button>
          ))
        ) : (
          <p role="status" className="seed-empty">
            No companies match. Try another name or select all review states.
          </p>
        )}
      </div>
      {current ? (
        <section className="seed-detail" aria-live="polite">
          <h3>{current.properties.name}</h3>
          <dl>
            <div>
              <dt>Category</dt>
              <dd>{current.research.category.replaceAll('_', ' ')}</dd>
            </div>
            <div>
              <dt>Activation evidence</dt>
              <dd>Unknown — no verified activity</dd>
            </div>
            <div>
              <dt>Exclusion check</dt>
              <dd>Unverified against the rule</dd>
            </div>
            <div>
              <dt>CRM record ID</dt>
              <dd>Not assigned — local fixture only</dd>
            </div>
          </dl>
          <div className="seed-warning">
            <TriangleAlert size={18} aria-hidden="true" />
            <p>
              {current.research.draft_gate === 'open'
                ? 'Read-only research can proceed. Sending and CRM writes remain blocked until identity, exclusions, inventory and permissions are resolved.'
                : 'Stop here. A client decision is required before drafting or execution; do not infer approval from a complete record.'}
            </p>
          </div>
        </section>
      ) : (
        <p className="seed-hint">Select a company to inspect its evidence and action boundaries.</p>
      )}
    </div>
  );
}
