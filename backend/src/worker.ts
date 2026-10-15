import { runPersistentVerificationCycle } from "./persistent-worker.js";

export function startWorker() {
  const timer = setInterval(() => { void runPersistentVerificationCycle(); }, 60_000);
  void runPersistentVerificationCycle();
  return () => clearInterval(timer);
}
