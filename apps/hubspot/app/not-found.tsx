import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>Let’s get you back on track.</h1>
      <p>This page doesn’t exist. Start with the handbook or use search to find a workflow.</p>
      <Link href="/docs">Back to the handbook →</Link>
    </main>
  );
}
