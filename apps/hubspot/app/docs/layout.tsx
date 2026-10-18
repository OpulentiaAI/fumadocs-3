import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { Workflow } from 'lucide-react';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <span className="brand">
            <Workflow aria-hidden="true" size={22} />
            <span>
              hubspot<span className="brand-sub">automation</span>
            </span>
          </span>
        ),
      }}
      sidebar={{
        banner: (
          <div className="library-switch">
            <span className="library-icon">H</span>
            <div>
              <strong>Automation handbook</strong>
              <span>Guides, recipes & agent skills</span>
            </div>
            <span aria-hidden="true">⌄</span>
          </div>
        ),
      }}
      links={[
        {
          text: 'Source repository',
          url: 'https://github.com/OpulentiaAI/fumadocs-3',
          external: true,
        },
      ]}
      tabs={false}
    >
      {children}
    </DocsLayout>
  );
}
