import { Studio } from '../components/Studio';

/**
 * The studio is a single client-side page. There is no server component doing
 * work here and no API route: the compiler and simulator run in the browser, so
 * a program written in the editor never leaves the machine it was typed on.
 */
export default function Page() {
  return <Studio />;
}
