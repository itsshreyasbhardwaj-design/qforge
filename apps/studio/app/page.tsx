import { Landing } from '../components/Landing';

/**
 * The landing page: what QForge is, what it cannot do, and how to check both.
 *
 * Deliberately static and free of client components, so it renders without
 * waiting for the editor's chunks. The studio lives at `/studio`.
 */
export default function Page() {
  return <Landing />;
}
