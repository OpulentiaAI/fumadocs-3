import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';

export const metadata: Metadata = {
  title: { default: 'HubSpot Automation Handbook', template: '%s · HubSpot Automation' },
  description:
    'Evidence-led CRM automation. Practical HubSpot recipes, agent skills and operational guardrails.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body>
        <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
      </body>
    </html>
  );
}
