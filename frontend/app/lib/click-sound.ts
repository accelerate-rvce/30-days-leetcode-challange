// Global interface click.
//
// Every click anywhere in the app gets a short mouse-click tick. A small pool
// of preloaded elements lets fast successive clicks overlap instead of cutting
// each other off, and playing from the click event itself keeps the browser's
// autoplay policy satisfied.
import { getSoundVolume, isSoundEnabled } from "./sound-settings";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const source = `${basePath}/sounds/air-swish-jam-fx-1-1-00-00.mp3`;
const baseVolume = 0.35;
const poolSize = 4;

let pool: HTMLAudioElement[] = [];
let next = 0;

function voices() {
  if (typeof window === "undefined") return [];
  if (!pool.length) {
    pool = Array.from({ length: poolSize }, () => {
      const audio = new Audio(source);
      audio.preload = "auto";
      audio.volume = baseVolume;
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
  if (!isSoundEnabled("interface")) return;
  const available = voices();
  if (!available.length) return;
  const audio = available[next % available.length];
  next += 1;
  // Read the live preference on every tick so a volume change is heard at once.
  audio.volume = Math.min(1, baseVolume * getSoundVolume());
  try { audio.currentTime = 0; } catch { /* not seekable yet */ }
  void audio.play().catch(() => { /* blocked or undecodable: no tick */ });
}
