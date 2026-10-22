import type { Metadata } from 'next';
import { Studio } from '../../components/Studio';

export const metadata: Metadata = {
  title: 'QForge Studio',
  description:
    'Write quantum programs and understand what they do: a compiler, statevector simulator and step debugger for the QForge language, running entirely in your browser.',
};

/**
 * The studio is a single client-side page. There is no server component doing
 * work here and no API route: the compiler and simulator run in the browser, so
 * a program written in the editor never leaves the machine it was typed on.
 */
export default function Page() {
  return <Studio />;
}
