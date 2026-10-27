import ChallengeApp from "../../components/ChallengeApp";

// This layout stays mounted while navigating between dashboard routes, so the
// app's auth, challenge, and progress state is fetched once and preserved.
export default function DashboardLayout() {
  return <ChallengeApp />;
}
