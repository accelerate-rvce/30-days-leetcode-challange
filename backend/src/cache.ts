// Tiny in-process cache for data that every page load asks for but almost
// never changes (settings, the challenge list, the leaderboard).
//
// Two goals:
//   1. The dashboard bootstrap touches the same rows for every student, so a
//      few seconds of shared memory removes most of the database round trips.
//   2. Concurrent requests for the same key share one in-flight promise
//      instead of stampeding the database on a cold start.
//
// This is per-instance. Values are short-lived (seconds), so multiple backend
// replicas can disagree for at most one TTL. Write paths invalidate the keys
// they affect, which keeps the common admin flow immediate.
const store = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 200;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const request = load()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) {
        const now = Date.now();
        for (const [entryKey, entry] of store) if (entry.expiresAt <= now) store.delete(entryKey);
        if (store.size >= MAX_ENTRIES) store.clear();
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** Drop everything, or every key starting with `prefix`. */
export function invalidate(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
