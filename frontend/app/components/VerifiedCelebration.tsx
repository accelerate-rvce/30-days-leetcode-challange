"use client";

import { useEffect } from "react";
import { Kabi } from "./Kabi";

type VerifiedCelebrationProps = {
  points: number;
  day?: number;
  onDismiss: () => void;
};

export default function VerifiedCelebration({ points, day, onDismiss }: VerifiedCelebrationProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 12_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <aside className="verified-celebration" role="status" aria-live="polite">
      <div className="kabi-stage"><Kabi pose={7} mood={1} onPoke={onDismiss} /></div>
      <div className="verified-copy">
        <p className="eyebrow"><span className="accent-dot" /> SUBMISSION VERIFIED</p>
        <strong>+{points} points</strong>
        <span>{day ? `Day ${String(day).padStart(2, "0")} is on your record.` : "Your accepted submission is on record."}</span>
      </div>
      <button type="button" className="celebration-dismiss" onClick={onDismiss} aria-label="Dismiss verification message">×</button>
    </aside>
  );
}
