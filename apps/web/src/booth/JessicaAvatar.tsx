"use client";

import { useEffect, useRef } from "react";

export type AvatarMode = "idle" | "listening" | "thinking" | "speaking" | "attention";

export function JessicaAvatar({ mode, mouth }: { mode: AvatarMode; mouth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const mouthRef = useRef(mouth);

  useEffect(() => {
    modeRef.current = mode;
    mouthRef.current = mouth;
  }, [mode, mouth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      frame += 1;
      const css = canvas.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixels = Math.max(1, Math.floor(css * dpr));
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = css;
      const time = reduced ? 0 : frame / 60;
      const currentMode = modeRef.current;
      const speak = currentMode === "speaking" ? Math.max(mouthRef.current, 0.35) : 0;
      paintAvatar(context, size, time, currentMode, speak);
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      aria-hidden="true"
    />
  );
}

function paintAvatar(
  ctx: CanvasRenderingContext2D,
  size: number,
  time: number,
  mode: AvatarMode,
  speak: number,
) {
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size * 0.46;
  const breathe = mode === "speaking" ? 1 : 1 + Math.sin(time * 1.6) * 0.012;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(breathe, breathe);
  ctx.translate(-cx, -cy);

  const ring = size * 0.42;
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.strokeStyle = mode === "listening" ? "#d7a441" : mode === "attention" ? "#e7ece4" : "#8ea396";
  ctx.lineWidth = size * 0.012;
  ctx.globalAlpha = 0.9;
  ctx.stroke();

  if (mode === "listening" || mode === "speaking") {
    const pulse = (time * (mode === "listening" ? 0.8 : 1.4)) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ring * (0.86 + pulse * 0.28), 0, Math.PI * 2);
    ctx.strokeStyle = mode === "listening" ? "#e4b15a" : "#f4f1ea";
    ctx.globalAlpha = 1 - pulse;
    ctx.lineWidth = size * 0.008;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.08, size * 0.34, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fillStyle = "#1c2b24";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "#f3e2cf";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.02, size * 0.26, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fillStyle = "#24352c";
  ctx.fill();

  const blink = Math.sin(time * 0.7) > 0.97 ? 0.15 : 1;
  const eyeY = cy - size * 0.02 + (mode === "thinking" ? -size * 0.015 : 0);
  const eyeOpen = mode === "listening" ? 1.15 : blink;
  drawEye(ctx, cx - size * 0.075, eyeY, size, eyeOpen);
  drawEye(ctx, cx + size * 0.075, eyeY, size, eyeOpen);

  const mouthOpen = mode === "speaking"
    ? 0.08 + speak * 0.22
    : mode === "listening"
      ? 0.045
      : 0.03;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.09, size * 0.055, size * mouthOpen, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#6d3b32";
  ctx.fill();

  if (mode === "thinking") {
    for (let i = 0; i < 3; i += 1) {
      const angle = time * 2 + i;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * size * 0.33, cy - size * 0.28 + Math.sin(angle) * size * 0.02, size * 0.012, 0, Math.PI * 2);
      ctx.fillStyle = "#e4b15a";
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, open: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.12, open));
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.028, size * 0.034, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1b2420";
  ctx.fill();
  ctx.restore();
}
