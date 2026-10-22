import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QForge',
  description:
    'A small quantum programming language with a compiler written from scratch, an independent statevector simulator and a step debugger. Runs entirely in your browser.',
  applicationName: 'QForge',
  authors: [{ name: 'QForge' }],
  keywords: ['quantum computing', 'compiler', 'OpenQASM', 'simulator', 'education'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0d10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
