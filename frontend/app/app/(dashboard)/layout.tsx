import { Suspense } from "react";
import ChallengeApp from "../../components/ChallengeApp";

// This layout stays mounted while navigating between dashboard routes, so the
// app's auth, challenge, and progress state is fetched once and preserved.
// Suspense is required because ChallengeApp reads `?day=` with useSearchParams
// and every dashboard page is prerendered.
export default function DashboardLayout() {
  return (
    <Suspense fallback={<main className="entry-splash" aria-label="Loading the dashboard" />}>
      <ChallengeApp />
    </Suspense>
  );
}
