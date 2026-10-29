"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getServerSoundSettingsSnapshot,
  getSoundSettingsSnapshot,
  setMasterSoundEnabled,
  setSoundVolume,
  subscribeSoundSettings,
  type SoundSettings,
} from "../lib/sound-settings";
import { playClickSound } from "../lib/click-sound";

// Bump this when the announcement copy changes and it should be shown again.
const announcementVersion = "v1";

function seenKey(userId: string) {
  return `30days:sound-announcement:${announcementVersion}:${userId || "guest"}`;
}

/**
 * One-time notice that sound effects are now adjustable. It waits for the
 * dashboard to settle, shows the current volume (so the saved preference is
 * visible straight away), and records that this account has seen it.
 */
export default function SoundAnnouncement({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const settings: SoundSettings = useSyncExternalStore(
    subscribeSoundSettings,
    getSoundSettingsSnapshot,
    getServerSoundSettingsSnapshot,
  );
  const primary = useRef<HTMLButtonElement>(null);
  const percent = Math.round(settings.volume * 100);

  const dismiss = useCallback(() => {
    setOpen(false);
    try { window.localStorage.setItem(seenKey(userId), "1"); } catch { /* private mode: ask again next visit */ }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let seen = true;
    try { seen = Boolean(window.localStorage.getItem(seenKey(userId))); } catch { return; }
    if (seen) return;
    const timer = window.setTimeout(() => setOpen(true), 1_100);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="sound-announcement"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sound-announcement-title"
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <div className="sound-announcement-panel">
        <span className="sound-announcement-badge">UPDATE · SOUND</span>
        <h2 id="sound-announcement-title">You can tune the sound now.</h2>
        <p>
          Every effect has its own switch, one master mute, and a volume you control.
          The speaker button next to Profile keeps your choice saved for this account.
        </p>
        <div className="sound-announcement-volume">
          <span>VOLUME <b>{percent}%</b></span>
          <input
            className="sound-range"
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            aria-label="Sound effect volume"
            onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
            onKeyUp={(event) => { if (/^(Arrow|Home|End)/.test(event.key)) playClickSound(); }}
          />
        </div>
        <div className="sound-announcement-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => { setMasterSoundEnabled(false); dismiss(); }}
          >
            Mute everything
          </button>
          <button type="button" className="primary-button" ref={primary} onClick={dismiss}>
            Got it <span>→</span>
          </button>
        </div>
        <small className="sound-announcement-hint">Reopen these controls any time from the speaker icon in the header.</small>
      </div>
    </div>
  );
}
