"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-canvas";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

// `lookX` / `lookY` accept -100..100 on the artboard; anything past that
// clamps, so pointer offsets are normalized to this range.
const LOOK_RANGE = 100;

type KabiProps = {
  pose?: number;
  mood?: number;
  /** Turn Kabi's head/eyes toward the pointer. On by default. */
  followPointer?: boolean;
  onPoke?: () => void;
};

/**
 * Kabi, the club mascot. The file lives at `public/kabi.riv` with a state
 * machine called `Kabi` exposing `pose`, `mood`, `lookX`, `lookY`, and `jump`.
 *
 * Poses/moods are whatever the artboard defines; the numbers pass straight
 * through (7 = celebrate, 1 = happy).
 *
 * Until that file exists the component renders a small verified medallion
 * instead of an empty canvas, so the celebration never looks broken.
 */
export function Kabi({ pose = 0, mood = 0, followPointer = true, onPoke }: KabiProps) {
  const [failed, setFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { rive, RiveComponent } = useRive({
    src: `${basePath}/kabi.riv`,
    stateMachine: "Kabi",
    autoplay: true,
    onLoadError: () => {
      setFailed(true);
      if (process.env.NODE_ENV !== "production") console.warn("kabi.riv is missing from public/; showing the fallback mark.");
    },
  });

  const poseIn = useStateMachineInput(rive, "Kabi", "pose");
  const moodIn = useStateMachineInput(rive, "Kabi", "mood");
  const lookX = useStateMachineInput(rive, "Kabi", "lookX");
  const lookY = useStateMachineInput(rive, "Kabi", "lookY");
  const jump = useStateMachineInput(rive, "Kabi", "jump");

  // Rive's machine inputs are mutable proxies the runtime owns; assigning to
  // them is the documented way to drive a state machine from React.
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { if (poseIn) poseIn.value = pose; }, [poseIn, pose]);
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { if (moodIn) moodIn.value = mood; }, [moodIn, mood]);

  // Eye tracking: throttle pointer events to one write per frame so a bouncy
  // mouse can't outrun the render loop.
  useEffect(() => {
    if (!followPointer || !lookX || !lookY) return;
    let pointer: PointerEvent | null = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const stage = stageRef.current;
      if (!pointer || !stage) return;
      const rect = stage.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // Half the viewport is the "fully looking" radius, so the gaze travels
      // as the pointer moves anywhere on the page instead of pinning to the
      // extreme as soon as it leaves the 92px card.
      const nx = clamp((pointer.clientX - centerX) / Math.max(window.innerWidth / 2, 1));
      const ny = clamp((pointer.clientY - centerY) / Math.max(window.innerHeight / 2, 1));
      lookX.value = Math.round(nx * LOOK_RANGE);
      lookY.value = Math.round(ny * LOOK_RANGE);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [followPointer, lookX, lookY]);

  // A 404 can surface slowly or not at all depending on the browser; don't
  // leave an empty square on screen while it resolves.
  useEffect(() => {
    if (rive) return;
    const timer = window.setTimeout(() => setStalled(true), 4_000);
    return () => window.clearTimeout(timer);
  }, [rive]);

  if (failed || (stalled && !rive)) return <KabiMark />;

  return (
    <div className="kabi-follow" ref={stageRef}>
      <RiveComponent
        className="kabi-canvas"
        role="img"
        aria-label="Kabi celebrates your verified submission"
        onClick={() => { jump?.fire(); onPoke?.(); }}
      />
    </div>
  );
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function KabiMark() {
  const gradientId = `kabi-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="kabi-mark" viewBox="0 0 64 64" role="img" aria-label="Submission verified">
      <defs>
        <linearGradient id={gradientId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset=".5" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="27" fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.5" opacity=".55" />
      <path d="M20 33.5 28.5 42 45 23" fill="none" stroke={`url(#${gradientId})`} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
    </svg>
  );
}
