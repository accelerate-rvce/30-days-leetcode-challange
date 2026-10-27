"use client";

import { useEffect } from "react";

import { Kabi } from "./Kabi";
import { startCelebrationMusic, stopCelebrationMusic } from "../lib/verified-sound";

type VerifiedCelebrationProps = {
  points: number;
  day?: number;
  onDismiss: () => void;
};

export default function VerifiedCelebration({ points, day, onDismiss }: VerifiedCelebrationProps) {
  // The confirmation hit already played before this mounted. The mascot brings
  // its own loop, which runs until the overlay is closed and then stops.
  useEffect(() => {
    void startCelebrationMusic();
    return () => stopCelebrationMusic();
  }, []);

  // The overlay owns the screen, so Escape closes it and the page underneath
  // must not scroll. Both are restored if the component unmounts early.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onDismiss]);

  return (
    <aside
      className="verified-celebration"
      role="dialog"
      aria-modal="true"
      aria-label="Submission verified"
      onClick={onDismiss}
    >
      <div className="verified-panel" onClick={(event) => event.stopPropagation()}>
        <div className="kabi-stage"><Kabi pose={7} mood={1} onPoke={onDismiss} /></div>
        <div className="verified-copy">
          <p className="eyebrow"><span className="accent-dot" /> SUBMISSION VERIFIED</p>
          <strong>+{points} points</strong>
          <span>{day ? `Day ${String(day).padStart(2, "0")} is on your record.` : "Your accepted submission is on record."}</span>
        </div>
        <p className="celebration-hint">Click anywhere or press Esc to close</p>
        <button type="button" className="celebration-dismiss" onClick={onDismiss} aria-label="Dismiss verification message">×</button>
      </div>
    </aside>
  );
}
