// Verification sounds.
//
// Two assets play in order:
//   1. `verified-celebration.wav` — the short "verified" hit. It fires the
//      moment the verdict is confirmed, before anything appears on screen.
//   2. `verified-party.mp3` — the mascot moment's music, looped until the
//      student closes the celebration overlay.
//
// The mascot does not wait for the whole hit: it opens three seconds in, while
// the hit is still ringing, and the party loop starts with it.
//
// The verdict arrives from a websocket callback, not a click, so the browser
// needs the audio unlocked while the "Check Now" gesture is still fresh.
// `unlockVerifiedSound` runs in the click handler and decodes both files;
// `playVerifiedSound` / `startCelebrationMusic` run seconds later.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const tracks = {
  hit: `${basePath}/sounds/verified-celebration.wav`,
  party: `${basePath}/sounds/verified-party.mp3`,
} as const;

type Track = keyof typeof tracks;

let context: AudioContext | null = null;
const buffers: Record<Track, AudioBuffer | null> = { hit: null, party: null };
const preloads: Record<Track, Promise<void> | null> = { hit: null, party: null };
let partyPlayback: AudioBufferSourceNode | null = null;
let partyGain: GainNode | null = null;

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

function preload(track: Track, ctx: AudioContext) {
  if (preloads[track]) return preloads[track];
  preloads[track] = fetch(tracks[track])
    .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`sound_${response.status}`)))
    .then((data) => ctx.decodeAudioData(data))
    .then((decoded) => { buffers[track] = decoded; })
    .catch(() => { buffers[track] = null; });
  return preloads[track];
}

// Wait for a decode that started on click, but never hold the celebration for
// long: a missing asset just means that layer stays silent.
async function bufferFor(ctx: AudioContext, track: Track) {
  if (buffers[track]) return buffers[track];
  await Promise.race([preload(track, ctx), delay(500)]);
  return buffers[track];
}

async function runningContext(): Promise<AudioContext | null> {
  const ctx = getContext();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return null; }
  }
  return ctx.state === "running" ? ctx : null;
}

export function unlockVerifiedSound() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  void preload("hit", ctx);
  void preload("party", ctx);
}

// The overlay and its music join three seconds into the hit, so the mascot
// lands on the peak of the thunder instead of after it has fully died out.
const revealAfterMs = 3_000;

/**
 * Plays the confirmation hit and resolves when the mascot should appear (three
 * seconds in). The hit keeps playing underneath; its gain is only released
 * when the clip actually ends.
 */
export async function playVerifiedSound(): Promise<void> {
  const ctx = await Promise.race([runningContext(), delay(1_500).then(() => null)]);
  if (!ctx) return;
  const buffer = await bufferFor(ctx, "hit");
  if (!buffer) {
    synthChime(ctx);
    await delay(900);
    return;
  }
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  const playback = ctx.createBufferSource();
  playback.buffer = buffer;
  playback.connect(gain);
  gain.connect(ctx.destination);
  await new Promise<void>((resolve) => {
    const reveal = window.setTimeout(resolve, Math.min(buffer.duration * 1000, revealAfterMs));
    playback.onended = () => {
      window.clearTimeout(reveal);
      try { gain.disconnect(); } catch { /* already detached */ }
      resolve();
    };
    playback.start();
  });
}

/** Loops the mascot music until `stopCelebrationMusic` is called. */
export async function startCelebrationMusic(): Promise<void> {
  const ctx = await runningContext();
  if (!ctx) return;
  const buffer = await bufferFor(ctx, "party");
  if (!buffer) return;
  stopCelebrationMusic();
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  const playback = ctx.createBufferSource();
  playback.buffer = buffer;
  playback.loop = true;
  playback.connect(gain);
  gain.connect(ctx.destination);
  playback.start();
  partyPlayback = playback;
  partyGain = gain;
}

export function stopCelebrationMusic() {
  if (partyPlayback) {
    try { partyPlayback.stop(); } catch { /* already stopped */ }
    try { partyPlayback.disconnect(); } catch { /* already detached */ }
    partyPlayback = null;
  }
  if (partyGain) {
    try { partyGain.disconnect(); } catch { /* already detached */ }
    partyGain = null;
  }
}

// Used when the wav cannot be fetched, so the moment still has a sound.
function synthChime(ctx: AudioContext) {
  const start = ctx.currentTime;
  [1046.5, 1318.51, 1567.98, 2093].forEach((frequency, index) => {
    const at = start + index * 0.075;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  });
}
