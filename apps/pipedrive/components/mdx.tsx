import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { WorkflowMap, StartCards, Principles } from './overview';
import { SeedExplorer } from './seed-explorer';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    WorkflowMap,
    StartCards,
    Principles,
    SeedExplorer,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
