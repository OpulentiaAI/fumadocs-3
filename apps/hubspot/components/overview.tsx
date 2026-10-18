import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Database,
  GitBranch,
  ListChecks,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';

const lifecycleSteps = [
  { icon: Zap, number: '01', title: 'Capture', description: 'A meaningful signal' },
  { icon: Database, number: '02', title: 'Enrich', description: 'Evidence, not guesses' },
  { icon: GitBranch, number: '03', title: 'Decide', description: 'Rules before actions' },
  { icon: ShieldCheck, number: '04', title: 'Approve', description: 'A clear review boundary' },
  { icon: ListChecks, number: '05', title: 'Sync', description: 'Verify the CRM state' },
];

export function WorkflowMap() {
  return (
    <div
      className="workflow-map not-prose"
      aria-label="Automation lifecycle: signal, enrich, decide, approve, sync"
    >
      <div className="map-header">
        <span>
          <span className="status-dot" /> BUILT FOR REAL OPERATIONS
        </span>
        <span>Human judgement. Agent execution.</span>
      </div>
      <div className="map-title">
        Your CRM, working
        <br />
        <span>as one system.</span>
      </div>
      <p>
        From the first signal to the next best action.
        <br />
        Every write deliberate. Every outcome traceable.
      </p>
      <div className="map-flow">
        {lifecycleSteps.map(({ icon: Icon, number, title, description }, i) => (
          <div className="map-step" key={title}>
            <div className="step-top">
              <Icon size={19} aria-hidden="true" />
              <span>{number}</span>
            </div>
            <strong>{title}</strong>
            <small>{description}</small>
            {i < lifecycleSteps.length - 1 && (
              <ArrowRight className="step-arrow" size={14} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <div className="map-footer">
        <code>signal → plan → review → execute → verify</code>
        <span>SAFE BY DESIGN</span>
      </div>
    </div>
  );
}

export function StartCards() {
  const cards = [
    {
      icon: Terminal,
      title: 'Make your first safe write',
      description: 'Connect, inspect your schema and verify one reversible change.',
      href: '/docs/get-started/quickstart',
      label: 'Start the quickstart',
    },
    {
      icon: BookOpen,
      title: 'Find a proven workflow',
      description: 'Email enrichment, account research, warm outbound and more.',
      href: '/docs/best-practices',
      label: 'Explore best practices',
    },
    {
      icon: Database,
      title: 'Explore the seed scenario',
      description: 'Turn the sponsor showcase into a practical HubSpot data model.',
      href: '/docs/guides/seed-data',
      label: 'Understand the seed',
    },
    {
      icon: ShieldCheck,
      title: 'Build a reliable agent',
      description: 'Apply least privilege, review gates and evidence-led verification.',
      href: '/docs/agents',
      label: 'Read the operating model',
    },
  ];
  return (
    <div className="start-cards not-prose">
      {cards.map(({ icon: Icon, ...card }) => (
        <Link href={card.href} className="start-card" key={card.title}>
          <Icon size={21} aria-hidden="true" />
          <h3>{card.title}</h3>
          <p>{card.description}</p>
          <span>
            {card.label}
            <ArrowRight size={15} aria-hidden="true" />
          </span>
        </Link>
      ))}
    </div>
  );
}

export function Principles() {
  return (
    <div className="principles not-prose">
      <div>
        <span>01</span>
        <strong>Read before you write.</strong>
        <p>Inspect the live schema and the records you intend to change.</p>
      </div>
      <div>
        <span>02</span>
        <strong>Keep people in control.</strong>
        <p>Separate a proposed action from approval and execution.</p>
      </div>
      <div>
        <span>03</span>
        <strong>Prove the outcome.</strong>
        <p>A successful request is not a verified business result.</p>
      </div>
    </div>
  );
}
