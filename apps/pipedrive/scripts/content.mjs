import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableOfContents } from 'fumadocs-core/content/toc';

export function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? filesUnder(file) : [file];
  });
}

export function pageRoute(file, root) {
  const relative = path
    .relative(root, file)
    .replaceAll(path.sep, '/')
    .replace(/\.mdx?$/, '');
  return `/docs/${relative}`.replace(/\/index$/, '').replace(/\/$/, '');
}

function withoutCode(content) {
  let fence;
  return content
    .split('\n')
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = undefined;
        return '';
      }
      if (marker) {
        fence = marker[1];
        return '';
      }
      return line.replace(/(`+)([^`]|(?!\1)`)*\1/g, '');
    })
    .join('\n');
}

function linksIn(content, markdown = true) {
  const links = [];
  const source = markdown ? withoutCode(content) : content;
  for (const match of source.matchAll(/\bhref\s*(?:=\s*(?:\{\s*)?|:\s*)(?:"([^"]*)"|'([^']*)')/g)) {
    links.push(match[1] ?? match[2]);
  }
  if (!markdown) return { links, missingReferences: [] };
  const definitions = new Map();
  const normalise = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const match of source.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    definitions.set(normalise(match[1]), match[2] ?? match[3]);
  }
  for (const match of source.matchAll(
    /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|((?:[^\s()]|\([^()]*\))+))/g,
  )) {
    links.push(match[1] ?? match[2]);
  }
  const missingReferences = [];
  for (const match of source.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const label = normalise(match[2] || match[1]);
    if (!definitions.has(label)) missingReferences.push(label);
  }
  links.push(...definitions.values());
  return { links, missingReferences };
}

export function validateContent(
  root,
  inventory,
  {
    navigationFiles = [fileURLToPath(new URL('../components/overview.tsx', import.meta.url))],
  } = {},
) {
  const allFiles = filesUnder(root);
  const files = allFiles.filter((file) => /\.mdx?$/.test(file));
  const routes = new Map();
  const errors = [];
  for (const file of files) {
    const route = pageRoute(file, root);
    if (routes.has(route))
      errors.push(`Duplicate page route ${route}: ${routes.get(route)} and ${file}`);
    else routes.set(route, file);
  }
  const contents = new Map(
    files.map((file) => [file, readFileSync(file, 'utf8').replaceAll('\r\n', '\n')]),
  );
  const bodies = new Map(
    [...contents].map(([file, content]) => [
      file,
      content.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, ''),
    ]),
  );
  const anchors = new Map(
    [...bodies].map(([file, body]) => [
      file,
      new Set(getTableOfContents(body).map((heading) => heading.url.slice(1))),
    ]),
  );
  const checkLinks = (file, content, markdown) => {
    const { links, missingReferences } = linksIn(content, markdown);
    for (const label of missingReferences) errors.push(`${file}: missing link reference ${label}`);
    for (const link of links) {
      if (!link || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      let url;
      let route;
      let fragment;
      try {
        url = new URL(
          link,
          `https://handbook.invalid${markdown ? pageRoute(file, root) : '/docs'}`,
        );
        route = decodeURIComponent(url.pathname).replace(/\/$/, '');
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        errors.push(`${file}: invalid link ${link}`);
        continue;
      }
      if (route !== '/docs' && !route.startsWith('/docs/')) continue;
      const target = routes.get(route);
      if (!target) errors.push(`${file}: broken link ${link}`);
      else if (fragment && !anchors.get(target).has(fragment))
        errors.push(`${file}: broken anchor ${link}`);
    }
  };
  for (const file of files) {
    const content = contents.get(file);
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (
      !frontmatter ||
      !/^title: .+/m.test(frontmatter[1]) ||
      !/^description: .+/m.test(frontmatter[1])
    )
      errors.push(`${file}: missing title or description`);
    checkLinks(file, bodies.get(file), true);
    if (
      file.includes(`${path.sep}best-practices${path.sep}`) &&
      !file.endsWith('index.mdx') &&
      !content.includes('https://deepline.com/')
    )
      errors.push(`${file}: missing Deepline attribution`);
  }
  for (const file of navigationFiles) checkLinks(file, readFileSync(file, 'utf8'), false);
  for (const file of allFiles.filter((file) => file.endsWith('meta.json'))) {
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    for (const page of meta.pages || []) {
      if (page.startsWith('---') || page.startsWith('[') || page === '...') continue;
      const base = path.join(path.dirname(file), page);
      const route = pageRoute(`${base}.mdx`, root);
      if (!routes.has(route) && !files.some((item) => item.startsWith(`${base}${path.sep}`)))
        errors.push(`${file}: missing navigation page ${page}`);
    }
  }
  const seen = new Set();
  for (const guide of inventory.guides) {
    if (seen.has(guide.url)) errors.push(`Duplicate source URL: ${guide.url}`);
    seen.add(guide.url);
    const file = path.join(root, 'best-practices', `${guide.slug}.mdx`);
    if (!files.includes(file)) errors.push(`Missing guide: ${guide.slug}`);
    else if (!contents.get(file).includes(guide.url))
      errors.push(`Source URL mismatch: ${guide.slug}`);
  }
  if (inventory.guides.length !== inventory.expectedGuideCount)
    errors.push('Guide inventory count does not match discovered coverage');
  return {
    pages: files.length,
    guides: inventory.guides.length,
    routes: [...routes.keys()],
    errors,
  };
}
