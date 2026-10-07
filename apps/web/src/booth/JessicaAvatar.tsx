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
const MAGENTA_LIGHT = "#ffb3dc";
const MAGENTA_DEEP = "#b01568";
const MIDNIGHT = "#00072E";
const BLUSH = "rgba(255, 186, 214, 0.55)";

const INITIAL_SPRINGS: JessicaSprings = poseSprings("idle", 0);

export function JessicaAvatar({
  status,
  caption,
  mouth,
  pressed = false,
}: {
  status: string;
  caption: string;
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
      springs = {
        bob: approach(springs.bob, target.bob, dt, 8),
        tilt: approach(springs.tilt, target.tilt, dt, 8),
        smile: approach(springs.smile, target.smile, dt, 10),
        mouth: approach(springs.mouth, target.mouth, dt, 18),
        squash: approach(springs.squash, target.squash, dt, 16),
        brow: approach(springs.brow, target.brow, dt, 10),
        lean: approach(springs.lean, target.lean, dt, 8),
        eye: approach(springs.eye, target.eye, dt, 12),
      };
      paintPebble(context, canvas, time, currentPose, springs);
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
      data-chin={JESSICA_ANIMATION.chin}
      role="img"
      aria-label={`Jessica, Accel Analysis assistant, ${pose}`}
    />
  );
}

function paintPebble(
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

  const breathe = 1 + Math.sin(time * 1.7) * 0.012 * (0.4 + springs.bob);
  const bob = Math.sin(time * (pose === "celebrate" ? 2.4 : 1.35)) * css * 0.012 * springs.bob;
  const nod = pose === "celebrate" || pose === "happy"
    ? Math.sin(time * 2.2) * css * 0.01 * springs.bob
    : 0;
  const cx = css * 0.5;
  const cy = css * 0.52 + bob + nod - springs.lean * css * 0.012;
  const squashX = 1 + springs.squash * 0.07;
  const squashY = 1 - springs.squash * 0.1;
  const rx = css * 0.33 * breathe * squashX;
  const ry = css * 0.31 * breathe * squashY;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(springs.tilt + Math.sin(time * 0.6) * 0.015 * (pose === "idle" || pose === "listen" ? 1 : 0.4));
  ctx.translate(-cx, -cy);

  const glow = ctx.createRadialGradient(cx, cy, css * 0.04, cx, cy, css * 0.48);
  glow.addColorStop(0, "rgba(226,24,134,0.22)");
  glow.addColorStop(0.6, "rgba(3,201,255,0.08)");
  glow.addColorStop(1, "rgba(3,201,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, css * 0.46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(0, 7, 46, 0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.92, rx * 0.62, css * 0.028, 0, 0, Math.PI * 2);
  ctx.fill();

  // Smooth ellipse body. The lowest point is the center of the curve, so the chin stays round.
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, rx * 0.05, cx, cy, rx * 1.15);
  body.addColorStop(0, "#ffe4f3");
  body.addColorStop(0.28, MAGENTA_LIGHT);
  body.addColorStop(0.62, MAGENTA);
  body.addColorStop(1, MAGENTA_DEEP);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.28, ry * 0.16, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BLUSH;
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.48, cy + ry * 0.12, rx * 0.16, ry * 0.09, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + rx * 0.48, cy + ry * 0.12, rx * 0.16, ry * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  if (pose === "listen" || pose === "curious" || pose === "speaking" || pose === "engaged" || pose === "press") {
    const pulse = (time * 0.8) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rx * (1.05 + pulse * 0.16), 0, Math.PI * 2);
    ctx.strokeStyle = pose === "listen" || pose === "press" ? "#03C9FF" : MAGENTA_LIGHT;
    ctx.globalAlpha = 0.45 * (1 - pulse);
    ctx.lineWidth = css * 0.008;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawFace(ctx, cx, cy, css, time, pose, springs);
  ctx.restore();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  time: number,
  pose: JessicaPose,
  springs: JessicaSprings,
) {
  const glance = glanceOffset(time, pose);
  const open = blinkOpen(time, pose) * springs.eye;
  const eyeY = cy - size * 0.02;
  const spread = size * 0.105;
  drawBrow(ctx, cx - spread, eyeY - size * 0.07, size, springs.brow, -1);
  drawBrow(ctx, cx + spread, eyeY - size * 0.07, size, springs.brow, 1);
  drawEye(ctx, cx - spread, eyeY, size, open, glance.x, glance.y);
  drawEye(ctx, cx + spread, eyeY, size, open, glance.x, glance.y);
  drawMouth(ctx, cx, cy + size * 0.1, size, springs.smile, springs.mouth);
}

function drawBrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  brow: number,
  side: -1 | 1,
) {
  if (Math.abs(brow) < 0.12) return;
  ctx.save();
  ctx.translate(x, y - brow * size * 0.012);
  ctx.rotate(side * brow * -0.35);
  ctx.strokeStyle = MIDNIGHT;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = size * 0.01;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-size * 0.03, 0);
  ctx.quadraticCurveTo(0, -size * 0.012, size * 0.03, 0);
  ctx.stroke();
  ctx.restore();
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  open: number,
  glanceX: number,
  glanceY: number,
) {
  const gx = glanceX * size * 0.012;
  const gy = glanceY * size * 0.012;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, Math.max(0.08, open));
  ctx.fillStyle = "#fff7fb";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.052, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MIDNIGHT;
  ctx.beginPath();
  ctx.arc(gx, gy, size * 0.026, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1B1B1B";
  ctx.beginPath();
  ctx.arc(gx, gy, size * 0.013, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(gx - size * 0.01, gy - size * 0.012, size * 0.008, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  smile: number,
  open: number,
) {
  const width = size * (0.055 + Math.min(0.03, Math.abs(smile) * 0.03));
  const curve = size * 0.045 * smile;
  if (open > 0.2) {
    ctx.fillStyle = "#4a1234";
    ctx.beginPath();
    ctx.ellipse(x, y + curve * 0.25, width * 0.72, size * (0.012 + open * 0.045), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd6ea";
    ctx.beginPath();
    ctx.ellipse(x, y + curve * 0.15 - size * 0.004, width * 0.4, size * (0.005 + open * 0.012), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = MIDNIGHT;
  ctx.lineWidth = size * 0.012;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - width, y);
  ctx.quadraticCurveTo(x, y + curve, x + width, y);
  ctx.stroke();
}
