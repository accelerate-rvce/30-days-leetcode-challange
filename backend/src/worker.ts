import { runPersistentVerificationCycle } from "./persistent-worker.js";

export function startWorker() {
  const run = () => void runPersistentVerificationCycle().catch((error) => console.error("verification cycle failed", error));
  const timer = setInterval(run, 60_000);
  run();
  return () => clearInterval(timer);
}
