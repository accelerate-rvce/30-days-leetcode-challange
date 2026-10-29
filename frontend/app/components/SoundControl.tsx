"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  SOUND_CHANNELS,
  getServerSoundSettingsSnapshot,
  getSoundSettingsSnapshot,
  setChannelSoundEnabled,
  setMasterSoundEnabled,
  setSoundVolume,
  subscribeSoundSettings,
  type SoundChannel,
  type SoundSettings,
} from "../lib/sound-settings";
import { playClickSound } from "../lib/click-sound";

const channelCopy: Record<SoundChannel, { label: string; hint: string }> = {
  interface: { label: "Interface clicks", hint: "Every tap and button press" },
  handoff: { label: "LeetCode hand-off", hint: "The whoosh when a problem opens" },
  entrance: { label: "Entrance ident", hint: "The percussion note on arrival" },
  celebration: { label: "Verified celebration", hint: "Thunder hit and mascot music" },
};

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" />
      {muted ? (
        <path d="M16.2 9.3l4.2 5.4M20.4 9.3l-4.2 5.4" />
      ) : (
        <><path d="M15.5 9.2a4 4 0 0 1 0 5.6" /><path d="M18.2 6.8a7.6 7.6 0 0 1 0 10.4" /></>
      )}
    </svg>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="sound-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export default function SoundControl() {
  const [open, setOpen] = useState(false);
  // The store renders defaults on the server, then adopts the stored preference
  // after hydration without a mismatch warning.
  const settings: SoundSettings = useSyncExternalStore(
    subscribeSoundSettings,
    getSoundSettingsSnapshot,
    getServerSoundSettingsSnapshot,
  );
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const percent = Math.round(settings.volume * 100);
  // The capture-phase click handler runs before this state change, so a click
  // that turns sound back on would otherwise be silent. Play one tick to
  // confirm the switch actually did something.
  const interfaceAudible = settings.master && settings.channels.interface && settings.volume > 0;

  function toggleMaster(next: boolean) {
    setMasterSoundEnabled(next);
    if (!interfaceAudible && next && settings.channels.interface && settings.volume > 0) playClickSound();
  }

  function toggleChannel(channel: SoundChannel, next: boolean) {
    setChannelSoundEnabled(channel, next);
    if (channel === "interface" && !interfaceAudible && next && settings.master && settings.volume > 0) playClickSound();
  }

  function changeVolume(next: number) {
    setSoundVolume(Math.min(1, Math.max(0, next)));
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="sound-control" ref={root}>
      <button
        type="button"
        className={`sound-button ${open ? "active" : ""}`}
        aria-label={settings.master ? "Sound settings" : "Sound settings (muted)"}
        aria-expanded={open}
        aria-controls={panelId}
        title={settings.master ? `Sound effects on · ${percent}%` : "Sound effects off"}
        onClick={() => setOpen((value) => !value)}
      >
        <SpeakerIcon muted={!settings.master || settings.volume === 0} />
      </button>
      {open && (
        <div className="sound-panel" id={panelId} role="group" aria-label="Sound effects">
          <div className="sound-panel-head">
            <strong>SOUND EFFECTS</strong>
            <span>{settings.master ? `ON · ${percent}%` : "OFF"}</span>
          </div>
          <div className="sound-row master">
            <span className="sound-row-copy"><strong>All sound</strong><small>Master switch for every effect</small></span>
            <Switch checked={settings.master} label="All sound effects" onChange={toggleMaster} />
          </div>
          <div className={`sound-volume ${settings.master ? "" : "muted"}`}>
            <div className="sound-volume-head">
              <span className="sound-row-copy"><strong>Volume</strong><small>Every effect follows this level</small></span>
              <span className="sound-volume-value">{percent}%</span>
            </div>
            <div className="sound-volume-track">
              <button type="button" className="sound-step" onClick={() => changeVolume(settings.volume - 0.1)} aria-label="Decrease volume">−</button>
              <input
                className="sound-range"
                type="range"
                min={0}
                max={100}
                step={5}
                value={percent}
                aria-label="Sound effect volume"
                onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                onKeyUp={(event) => { if (/^(Arrow|Home|End)/.test(event.key)) playClickSound(); }}
              />
              <button type="button" className="sound-step" onClick={() => changeVolume(settings.volume + 0.1)} aria-label="Increase volume">+</button>
            </div>
          </div>
          <div className={`sound-channels ${settings.master ? "" : "muted"}`}>
            {SOUND_CHANNELS.map((channel) => (
              <div className="sound-row" key={channel}>
                <span className="sound-row-copy">
                  <strong>{channelCopy[channel].label}</strong>
                  <small>{channelCopy[channel].hint}</small>
                </span>
                <Switch
                  checked={settings.channels[channel]}
                  label={channelCopy[channel].label}
                  onChange={(next) => toggleChannel(channel, next)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
