// Hand-off sound for "Solve on LeetCode".
//
// A student pressing the button hears the whoosh while the attempt is being
// recorded, and only then lands on LeetCode. The clip is played from the click
// gesture itself, so autoplay policies allow it; `playWhoosh` resolves when the
// clip is over (or immediately gives up if the file cannot play) so the caller
// can navigate afterwards without leaving a silent gap.
import { getSoundVolume, isSoundEnabled } from "./sound-settings";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const source = `${basePath}/sounds/leetcode-whoosh.mp3`;
const baseVolume = 0.7;

const fallbackDelayMs = 600;

let element: HTMLAudioElement | null = null;

function getElement() {
  if (typeof window === "undefined") return null;
  if (!element) {
    element = new Audio(source);
    element.preload = "auto";
    element.volume = baseVolume;
  }
  return element;
}

// Never hold the hand-off longer than the clip itself, even if the ended event
// never arrives (a suspended tab, a codec hiccup).
function clipDurationMs(audio: HTMLAudioElement) {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 + 500 : 5_000;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/** Starts fetching the clip while the dashboard is idle. */
export function primeWhoosh() {
  const audio = getElement();
  if (audio) audio.load();
}

/**
 * Plays the whoosh and resolves when it finishes. If the browser refuses to
 * play (blocked context, missing asset) it resolves after a short beat so the
 * LeetCode hand-off still feels intentional.
 */
export function playWhoosh(): Promise<void> {
  // With the hand-off sound switched off, open LeetCode straight away.
  if (!isSoundEnabled("handoff")) return Promise.resolve();
  const audio = getElement();
  if (!audio) return Promise.resolve();
  audio.volume = Math.min(1, baseVolume * getSoundVolume());
  try { audio.currentTime = 0; } catch { /* not seekable yet */ }
  const playback = audio.play();
  if (!playback) return wait(fallbackDelayMs);
  return playback.then(() => new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safety);
      audio.onended = null;
      audio.onerror = null;
      resolve();
    };
    const safety = window.setTimeout(finish, clipDurationMs(audio));
    audio.onended = finish;
    audio.onerror = finish;
  })).catch(() => wait(fallbackDelayMs));
}
