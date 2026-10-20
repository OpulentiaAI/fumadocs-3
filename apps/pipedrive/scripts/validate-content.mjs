import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateContent } from './content.mjs';

const root = fileURLToPath(new URL('../content/docs', import.meta.url));
const inventory = JSON.parse(
  readFileSync(new URL('../data/deepline-guides.json', import.meta.url), 'utf8'),
);
const result = validateContent(root, inventory);
console.log(JSON.stringify(result, null, 2));
if (result.errors.length) process.exitCode = 1;
