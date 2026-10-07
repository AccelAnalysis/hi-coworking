"use client";

import { useEffect, useRef } from "react";
import {
  JESSICA_ANIMATION,
  approach,
  blinkOpen,
  glanceOffset,
  jessicaPose,
  poseSprings,
  type JessicaPose,
  type JessicaSprings,
} from "@/booth/jessicaEmotion";

const MAGENTA = "#e21886";

const INITIAL_SPRINGS: JessicaSprings = poseSprings("idle", 0);

export function JessicaAvatar({
  status,
  caption,
  mouth,
  pressed = false,
}: {
  status: string;
  caption: string;
  /** Voice level, 0–1. It squashes the circle. Nothing else is drawn from it. */
  mouth: number;
  pressed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pose = jessicaPose(status, caption, pressed);
  const poseRef = useRef(pose);
  const mouthRef = useRef(mouth);
  const talkingRef = useRef(status === "speaking");

  useEffect(() => {
    poseRef.current = pose;
    mouthRef.current = mouth;
    talkingRef.current = status === "speaking";
  }, [pose, mouth, status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let raf = 0;
    let last = performance.now();
    const started = last;
    let springs = { ...INITIAL_SPRINGS };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const tick = (now: number) => {
      const dt = reduced ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = reduced ? 1.2 : (now - started) / 1000;
      const currentPose = poseRef.current;
      const talk = talkingRef.current ? mouthRef.current : 0;
      const target = poseSprings(currentPose, talk);
      springs = reduced
        ? target
        : {
            bob: approach(springs.bob, target.bob, dt, 8),
            tilt: approach(springs.tilt, target.tilt, dt, 8),
            squash: approach(springs.squash, target.squash, dt, 22),
            lean: approach(springs.lean, target.lean, dt, 8),
            eye: approach(springs.eye, target.eye, dt, 12),
            squint: approach(springs.squint, target.squint, dt, 10),
            cheer: approach(springs.cheer, target.cheer, dt, 10),
            skew: approach(springs.skew, target.skew, dt, 10),
            voice: approach(springs.voice, target.voice, dt, 26),
          };
      paintBlob(context, canvas, time, currentPose, springs);
    };

    tick(performance.now());
    const onFrame = (now: number) => {
      tick(now);
      if (!reduced) raf = requestAnimationFrame(onFrame);
    };
    if (!reduced) raf = requestAnimationFrame(onFrame);
    const observer = new ResizeObserver(() => tick(performance.now()));
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      data-pose={pose}
      data-animation={JESSICA_ANIMATION.driver}
      data-target-fps={JESSICA_ANIMATION.targetFps}
      data-body={JESSICA_ANIMATION.body}
      role="img"
      aria-label={`Jessica, Accel Analysis assistant, ${pose}`}
    />
  );
}

function paintBlob(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  time: number,
  pose: JessicaPose,
  springs: JessicaSprings,
) {
  const css = canvas.clientWidth || 320;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.max(1, Math.floor(css * dpr));
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);

  const life = pose === "unavailable" ? 0.22 : 1;
  const wobble = (Math.sin(time * 1.85) * 0.22 + Math.sin(time * 3.15) * 0.1 + Math.sin(time * 5.05) * 0.04) * life;
  const syllable = Math.sin(time * 12.5) * springs.voice * 0.2;
  const squash = springs.squash + wobble * (0.55 + springs.bob * 0.45) + syllable;
  const scale = clamp(1 + squash * 0.34, 0.68, 1.48);
  const bob = Math.sin(time * (pose === "celebrate" ? 2.6 : 1.45)) * css * 0.016 * springs.bob;
  const cx = css * 0.5 + Math.sin(time * 0.85) * css * 0.012 * springs.lean;
  const cy = css * 0.5 + bob - springs.lean * css * 0.018;
  const radius = css * 0.34;
  const rx = radius * scale;
  const ry = radius / scale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(springs.tilt + Math.sin(time * 0.7) * 0.02 * life);
  ctx.translate(-cx, -cy);

  ctx.fillStyle = MAGENTA;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  drawEyes(ctx, cx, cy, rx, ry, css, time, pose, springs);
  ctx.restore();
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  size: number,
  time: number,
  pose: JessicaPose,
  springs: JessicaSprings,
) {
  const glance = glanceOffset(time, pose);
  const open = blinkOpen(time, pose) * springs.eye;
  const flatten = 1 - springs.squint * 0.78;
  const eyeRx = size * 0.058 * (1 + springs.squint * 0.18);
  const eyeRy = size * 0.066 * Math.max(0.08, open * flatten);
  const eyeY = cy - ry * 0.22 + glance.y * size * 0.02 - springs.cheer * size * 0.012;
  const spread = rx * 0.38;
  const gx = glance.x * size * 0.02;
  drawEye(ctx, cx - spread + gx, eyeY - springs.skew * size * 0.022, eyeRx, eyeRy, -1, springs.cheer);
  drawEye(ctx, cx + spread + gx, eyeY + springs.skew * size * 0.022, eyeRx, eyeRy, 1, springs.cheer);
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  side: -1 | 1,
  cheer: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-side * cheer * 0.5);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
