import { source } from '@/lib/source';

export async function GET() {
  const pages = await Promise.all(
    source
      .getPages()
      .map(
        async (page) =>
          `# ${page.data.title}\nSource page: ${page.url}\n\n${await page.data.getText('processed')}`,
      ),
  );
  return new Response(pages.join('\n\n---\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
