// Site entrance ident.
//
// Attempted as soon as the app boots. Browsers usually refuse autoplay until
// the visitor interacts, so a blocked play is re-armed and fires on the first
// pointer press or key stroke instead of being dropped. Plays once per page
// load; client-side navigation never restarts it.
import { getSoundVolume, isSoundEnabled } from "./sound-settings";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const source = `${basePath}/indian-percussion-ident-om-fx-1-00-04.mp3`;
const baseVolume = 0.45;

let element: HTMLAudioElement | null = null;
let played = false;
let armed = false;

function getElement() {
  if (typeof window === "undefined") return null;
  if (!element) {
    element = new Audio(source);
    element.preload = "auto";
    element.volume = baseVolume;
  }
  return element;
}

function disarm() {
  if (!armed) return;
  armed = false;
  window.removeEventListener("pointerdown", onFirstGesture, true);
  window.removeEventListener("keydown", onFirstGesture, true);
}

function arm() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  window.addEventListener("pointerdown", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);
}

function onFirstGesture() {
  disarm();
  attempt();
}

function attempt() {
  if (played) return;
  if (!isSoundEnabled("entrance")) { disarm(); return; }
  const audio = getElement();
  if (!audio) return;
  audio.volume = Math.min(1, baseVolume * getSoundVolume());
  const playback = audio.play();
  if (!playback) { arm(); return; }
  playback.then(() => { played = true; disarm(); }).catch(() => { arm(); });
}

/** Starts the ident now, or on the first interaction if autoplay is blocked. */
export function playSiteEntrance() {
  if (played) return;
  if (!isSoundEnabled("entrance")) return;
  const audio = getElement();
  if (audio) audio.load();
  attempt();
}
