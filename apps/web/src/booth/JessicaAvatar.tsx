"use client";

import { useEffect, useRef } from "react";
import { jessicaEmotion, type JessicaEmotion } from "@/booth/jessicaEmotion";

const MAGENTA = "#e21886";
const MAGENTA_LIGHT = "#ff9ed2";
const MAGENTA_DEEP = "#8d1458";
const NAVY = "#10243f";
const SKY = "#8ecaf0";

export function JessicaAvatar({
  status,
  caption,
  mouth,
}: {
  status: string;
  caption: string;
  mouth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emotion = jessicaEmotion(status, caption);
  const speaking = status === "speaking";
  const emotionRef = useRef(emotion);
  const mouthRef = useRef(mouth);
  const speakingRef = useRef(speaking);

  useEffect(() => {
    emotionRef.current = emotion;
    mouthRef.current = mouth;
    speakingRef.current = speaking;
  }, [emotion, mouth, speaking]);

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
      paintPebble(context, css, reduced ? 0.4 : frame / 60, {
        emotion: emotionRef.current,
        mouth: mouthRef.current,
        speaking: speakingRef.current,
        animate: !reduced,
      });
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      data-emotion={emotion}
      role="img"
      aria-label={`Jessica, Accel Analysis booth assistant, ${emotion}`}
    />
  );
}

function paintPebble(
  ctx: CanvasRenderingContext2D,
  size: number,
  time: number,
  pose: { emotion: JessicaEmotion; mouth: number; speaking: boolean; animate: boolean },
) {
  const { emotion, speaking, animate } = pose;
  const talk = speaking ? Math.max(0.28, Math.min(1, pose.mouth)) : 0;
  ctx.clearRect(0, 0, size, size);

  const float = animate
    ? Math.sin(time * (emotion === "happy" ? 2.1 : emotion === "concerned" ? 0.7 : 1.15)) * size * (emotion === "happy" ? 0.014 : 0.008)
    : 0;
  const tilt = animate ? tiltFor(emotion, time, talk) : emotion === "curious" ? -0.08 : emotion === "concerned" ? 0.05 : 0;
  const cx = size * 0.5;
  const cy = size * 0.52 + float;
  const rx = size * (0.34 + talk * 0.015);
  const ry = size * (0.3 - talk * 0.02);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.translate(-cx, -cy);

  const glow = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, size * 0.48);
  glow.addColorStop(0, emotion === "concerned" ? "rgba(16,36,63,0.55)" : "rgba(226,24,134,0.28)");
  glow.addColorStop(0.55, "rgba(142,202,240,0.16)");
  glow.addColorStop(1, "rgba(142,202,240,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(16, 36, 63, 0.45)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.92, rx * 0.72, size * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();

  pebblePath(ctx, cx, cy, rx, ry);
  const body = ctx.createRadialGradient(cx - rx * 0.38, cy - ry * 0.42, rx * 0.08, cx + rx * 0.1, cy + ry * 0.1, rx * 1.15);
  body.addColorStop(0, MAGENTA_LIGHT);
  body.addColorStop(0.42, MAGENTA);
  body.addColorStop(1, MAGENTA_DEEP);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  pebblePath(ctx, cx, cy, rx, ry);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.32, cy - ry * 0.38, rx * 0.28, ry * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const pulse = animate ? (time * (emotion === "curious" ? 1.3 : 0.8)) % 1 : 0.2;
  if (emotion === "curious" || emotion === "engaged" || speaking) {
    ctx.beginPath();
    ctx.arc(cx, cy, rx * (1.08 + pulse * 0.18), 0, Math.PI * 2);
    ctx.strokeStyle = emotion === "curious" ? SKY : MAGENTA_LIGHT;
    ctx.globalAlpha = 0.35 * (1 - pulse);
    ctx.lineWidth = size * 0.008;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawFace(ctx, cx, cy, size, emotion, time, talk, animate);
  ctx.restore();
}

function tiltFor(emotion: JessicaEmotion, time: number, talk: number) {
  if (emotion === "curious") return -0.1 + Math.sin(time * 0.9) * 0.04;
  if (emotion === "concerned") return 0.06;
  if (emotion === "happy") return Math.sin(time * 1.6) * 0.04;
  if (emotion === "engaged") return Math.sin(time * 3) * 0.02 * (0.4 + talk);
  return Math.sin(time * 0.55) * 0.02;
}

function pebblePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.bezierCurveTo(cx + rx * 0.62, cy - ry * 1.02, cx + rx * 1.02, cy - ry * 0.42, cx + rx * 0.96, cy + ry * 0.08);
  ctx.bezierCurveTo(cx + rx * 0.9, cy + ry * 0.55, cx + rx * 0.48, cy + ry * 1.02, cx + rx * 0.02, cy + ry * 0.9);
  ctx.bezierCurveTo(cx - rx * 0.42, cy + ry * 1.04, cx - rx * 0.9, cy + ry * 0.62, cx - rx * 0.98, cy + ry * 0.05);
  ctx.bezierCurveTo(cx - rx * 1.05, cy - ry * 0.48, cx - rx * 0.58, cy - ry * 1.01, cx, cy - ry);
  ctx.closePath();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  emotion: JessicaEmotion,
  time: number,
  talk: number,
  animate: boolean,
) {
  const blinkWindow = animate ? (time % 3.8) : 0;
  const blinking = blinkWindow > 3.55 && blinkWindow < 3.72;
  const open = blinking ? 0.12 : eyeOpen(emotion);
  const glance = glanceFor(emotion, size, time);
  const eyeY = cy - size * 0.045 + (emotion === "concerned" ? size * 0.012 : emotion === "curious" ? -size * 0.01 : 0);
  const spread = size * 0.09;
  drawEye(ctx, cx - spread, eyeY + (emotion === "curious" ? -size * 0.012 : 0), size, open, glance.x, glance.y, emotion === "happy" && !blinking);
  drawEye(ctx, cx + spread, eyeY, size, open, glance.x, glance.y, emotion === "happy" && !blinking);
  drawMouth(ctx, cx, cy + size * 0.07, size, emotion, talk);
}

function eyeOpen(emotion: JessicaEmotion) {
  if (emotion === "curious") return 1.18;
  if (emotion === "engaged") return 1.05;
  if (emotion === "concerned") return 0.62;
  if (emotion === "happy") return 0.78;
  return 0.92;
}

function glanceFor(emotion: JessicaEmotion, size: number, time: number) {
  if (emotion === "curious") {
    return { x: size * 0.01 + Math.sin(time * 0.7) * size * 0.004, y: -size * 0.012 };
  }
  if (emotion === "concerned") return { x: 0, y: size * 0.008 };
  if (emotion === "happy") return { x: 0, y: -size * 0.004 };
  if (emotion === "engaged") return { x: Math.sin(time * 1.4) * size * 0.003, y: 0 };
  return { x: Math.sin(time * 0.4) * size * 0.003, y: 0 };
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  open: number,
  glanceX: number,
  glanceY: number,
  smileEye: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  if (smileEye) {
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = size * 0.012;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, size * 0.01, size * 0.028, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.scale(1, Math.max(0.12, open));
  ctx.fillStyle = "#fff7fb";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.034, size * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.arc(glanceX, glanceY, size * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(glanceX - size * 0.006, glanceY - size * 0.006, size * 0.006, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  emotion: JessicaEmotion,
  talk: number,
) {
  ctx.strokeStyle = NAVY;
  ctx.fillStyle = NAVY;
  ctx.lineWidth = size * 0.01;
  ctx.lineCap = "round";
  if (talk > 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.04, size * (0.012 + talk * 0.045), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (emotion === "concerned") {
    ctx.arc(x, y + size * 0.03, size * 0.04, Math.PI * 1.15, Math.PI * 1.85, true);
  } else if (emotion === "curious") {
    ctx.ellipse(x, y, size * 0.018, size * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  } else if (emotion === "happy") {
    ctx.arc(x, y - size * 0.01, size * 0.05, Math.PI * 0.15, Math.PI * 0.85);
  } else {
    ctx.arc(x, y, size * 0.035, Math.PI * 0.2, Math.PI * 0.8);
  }
  ctx.stroke();
}
