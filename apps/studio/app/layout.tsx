import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QForge Studio',
  description:
    'Write quantum programs and understand what they do: a compiler, statevector simulator and step debugger for the QForge language, running entirely in your browser.',
  applicationName: 'QForge Studio',
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
