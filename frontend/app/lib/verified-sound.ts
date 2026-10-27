// Verification chime.
//
// The verdict arrives from a websocket callback, not a click, so the browser
// needs the audio context unlocked while the "Check Now" gesture is still
// fresh. `unlockVerifiedSound` runs in the click handler; `playVerifiedSound`
// runs when the completion row flips to verified, seconds later.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const source = `${basePath}/sounds/verified-celebration.wav`;

let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let preloading: Promise<void> | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

function preload(ctx: AudioContext) {
  if (preloading) return preloading;
  preloading = fetch(source)
    .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`sound_${response.status}`)))
    .then((data) => ctx.decodeAudioData(data))
    .then((decoded) => { buffer = decoded; })
    .catch(() => { buffer = null; });
  return preloading;
}

export function unlockVerifiedSound() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  void preload(ctx);
}

export async function playVerifiedSound() {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return; }
  }
  if (!buffer && preloading) {
    // Give the local asset a moment to decode; never hold the UI for it.
    await Promise.race([preloading, new Promise((resolve) => window.setTimeout(resolve, 400))]);
  }
  if (buffer) {
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    const playback = ctx.createBufferSource();
    playback.buffer = buffer;
    playback.connect(gain);
    gain.connect(ctx.destination);
    playback.start();
    return;
  }
  synthChime(ctx);
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
