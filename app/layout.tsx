import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Genome Match — Promoter Motif Search',
  description:
    'Search human and house mouse promoter windows (0–10,000 bp upstream) for IUPAC-aware motifs and export multi-tab reports.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
