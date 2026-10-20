import { source } from '@/lib/source';

export function GET() {
  const pages = source
    .getPages()
    .map((page) => `- [${page.data.title}](${page.url}): ${page.data.description || ''}`)
    .join('\n');
  return new Response(
    `# Pipedrive Automation Handbook\n\nIndependent, evidence-led CRM automation guidance. No live CRM writes are performed by this site.\n\n${pages}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
