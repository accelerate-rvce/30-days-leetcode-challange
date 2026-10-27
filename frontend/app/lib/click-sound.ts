// Global interface click.
//
// Every click anywhere in the app gets a short mouse-click tick. A small pool
// of preloaded elements lets fast successive clicks overlap instead of cutting
// each other off, and playing from the click event itself keeps the browser's
// autoplay policy satisfied.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const source = `${basePath}/sounds/click.mp3`;
const volume = 0.35;
const poolSize = 4;

let pool: HTMLAudioElement[] = [];
let next = 0;

function voices() {
  if (typeof window === "undefined") return [];
  if (!pool.length) {
    pool = Array.from({ length: poolSize }, () => {
      const audio = new Audio(source);
      audio.preload = "auto";
      audio.volume = volume;
      return audio;
    });
  }
  return pool;
}

/** Fetches the clip while the dashboard is idle so the first click is silent-proof. */
export function primeClickSound() {
  voices().forEach((audio) => { try { audio.load(); } catch { /* the click just stays silent */ } });
}

/** Plays one tick. Safe to call from any click handler, including keyboard-driven clicks. */
export function playClickSound() {
  const available = voices();
  if (!available.length) return;
  const audio = available[next % available.length];
  next += 1;
  try { audio.currentTime = 0; } catch { /* not seekable yet */ }
  void audio.play().catch(() => { /* blocked or undecodable: no tick */ });
}
