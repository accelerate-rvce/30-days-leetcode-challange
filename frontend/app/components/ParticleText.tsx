"use client";

import { CSSProperties, useEffect, useRef } from "react";
import styles from "./ParticleText.module.css";

type Particle = { x: number; y: number; startX: number; startY: number; targetX: number; targetY: number; size: number; seed: number; delay: number; };

type ParticleTextProps = {
  text: string;
  particleSize?: number;
  density?: number;
  color?: string;
  highlightColor?: string;
  scatter?: number;
  gatherDuration?: number;
  stagger?: number;
  pointerRepel?: number;
  repelRadius?: number;
  idleDrift?: number;
  fontSize?: string;
  fontWeight?: number;
  fontFamily?: string;
  className?: string;
  style?: CSSProperties;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const easeOut = (value: number) => 1 - Math.pow(1 - value, 3);

export default function ParticleText({
  text,
  particleSize = 1.7,
  density = 4,
  color = "#22d3ee",
  highlightColor = "#a855f7",
  scatter = 150,
  gatherDuration = 1300,
  stagger = 300,
  pointerRepel = 26,
  repelRadius = 105,
  idleDrift = 0.45,
  fontSize = "clamp(2.5rem, 8vw, 5.4rem)",
  fontWeight = 800,
  fontFamily = "inherit",
  className = "",
  style,
}: ParticleTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let particles: Particle[] = [];
    let animationFrame = 0;
    let resizeFrame = 0;
    let width = 0;
    let height = 0;
    let gatherStart = performance.now();
    let prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0 };

    const resolvedFontSize = () => {
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;font-size:${fontSize};font-weight:${fontWeight};font-family:${fontFamily === "inherit" ? getComputedStyle(container).fontFamily : fontFamily}`;
      probe.textContent = "M";
      container.appendChild(probe);
      const value = parseFloat(getComputedStyle(probe).fontSize) || 72;
      probe.remove();
      return value;
    };

    const sample = () => {
      const rect = container.getBoundingClientRect();
      width = Math.floor(rect.width);
      height = Math.floor(rect.height);
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const fontPx = resolvedFontSize();
      const family = fontFamily === "inherit" ? getComputedStyle(container).fontFamily : fontFamily;
      let font = `${fontWeight} ${fontPx}px ${family}`;
      const offscreen = document.createElement("canvas");
      const offContext = offscreen.getContext("2d", { willReadFrequently: true });
      if (!offContext) return;
      offContext.font = font;
      let metrics = offContext.measureText(text);
      const maxWidth = width * 0.94;
      const size = metrics.width > maxWidth ? Math.max(18, fontPx * (maxWidth / metrics.width)) : fontPx;
      font = `${fontWeight} ${size}px ${family}`;
      offContext.font = font;
      metrics = offContext.measureText(text);
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent || size * 0.75);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent || size * 0.25);
      const textWidth = Math.ceil(metrics.width);
      const padding = Math.ceil(size * 0.14);
      offscreen.width = textWidth + padding * 2;
      offscreen.height = ascent + descent + padding * 2;
      offContext.font = font;
      offContext.fillStyle = "#fff";
      offContext.textBaseline = "alphabetic";
      offContext.fillText(text, padding, padding + ascent);
      const pixels = offContext.getImageData(0, 0, offscreen.width, offscreen.height).data;
      const targets: { x: number; y: number }[] = [];
      const step = Math.max(2, Math.floor(density));
      for (let y = 0; y < offscreen.height; y += step) for (let x = 0; x < offscreen.width; x += step) if (pixels[(y * offscreen.width + x) * 4 + 3] > 48) targets.push({ x: width / 2 - offscreen.width / 2 + x, y: height / 2 - offscreen.height / 2 + y });
      const stride = Math.max(1, Math.ceil(targets.length / 4200));
      particles = targets.filter((_, index) => index % stride === 0).map((target, index) => {
        const seed = ((index * 9301 + 49297) % 233280) / 233280;
        const angle = seed * Math.PI * 2;
        const distance = prefersReducedMotion ? 0 : scatter * (0.4 + seed * 0.7);
        const startX = target.x + Math.cos(angle) * distance;
        const startY = target.y + Math.sin(angle) * distance;
        return { x: startX, y: startY, startX, startY, targetX: target.x, targetY: target.y, size: particleSize * (0.8 + seed * 0.4), seed, delay: prefersReducedMotion ? 0 : seed * stagger };
      });
      pointer.x = pointer.smoothX = width / 2;
      pointer.y = pointer.smoothY = height / 2;
      gatherStart = performance.now();
    };

    const render = (now: number) => {
      context.clearRect(0, 0, width, height);
      context.shadowBlur = prefersReducedMotion ? 0 : particleSize * 2.6;
      context.shadowColor = highlightColor;
      const brandGradient = context.createLinearGradient(0, 0, width, height);
      brandGradient.addColorStop(0, color);
      brandGradient.addColorStop(1, highlightColor);
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;
      particles.forEach((particle) => {
        const progress = clamp((now - gatherStart - particle.delay) / Math.max(1, gatherDuration), 0, 1);
        let x = particle.startX + (particle.targetX - particle.startX) * easeOut(progress);
        let y = particle.startY + (particle.targetY - particle.startY) * easeOut(progress);
        if (progress === 1 && !prefersReducedMotion) { x += Math.sin(now * 0.0008 + particle.seed * 20) * idleDrift; y += Math.cos(now * 0.0007 + particle.seed * 20) * idleDrift; }
        if (pointer.active && !prefersReducedMotion) { const dx = x - pointer.smoothX; const dy = y - pointer.smoothY; const distance = Math.hypot(dx, dy); if (distance > 0 && distance < repelRadius) { const force = Math.pow(1 - distance / repelRadius, 2) * pointerRepel; x += dx / distance * force; y += dy / distance * force; } }
        particle.x += (x - particle.x) * (prefersReducedMotion ? 1 : .22);
        particle.y += (y - particle.y) * (prefersReducedMotion ? 1 : .22);
        context.fillStyle = brandGradient;
        context.globalAlpha = .4 + progress * .6;
        context.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
      });
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      animationFrame = requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top; pointer.active = true; };
    const onLeave = () => { pointer.active = false; };
    const onResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(sample); };
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onReducedMotion = () => { prefersReducedMotion = mediaQuery.matches; sample(); };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onLeave);
    mediaQuery.addEventListener("change", onReducedMotion);
    sample();
    animationFrame = requestAnimationFrame(render);
    return () => { observer.disconnect(); canvas.removeEventListener("pointermove", onPointerMove); canvas.removeEventListener("pointerleave", onLeave); mediaQuery.removeEventListener("change", onReducedMotion); cancelAnimationFrame(animationFrame); cancelAnimationFrame(resizeFrame); };
  }, [text, particleSize, density, color, highlightColor, scatter, gatherDuration, stagger, pointerRepel, repelRadius, idleDrift, fontSize, fontWeight, fontFamily]);

  return <div ref={containerRef} className={`${styles.root} ${className}`} style={style} aria-label={text}><canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" /><span className={styles.screenReader}>{text}</span></div>;
}
