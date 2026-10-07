/**
 * Jessica's pose library. She is a flat circle. Expression is eye shape and
 * position, plus the circle squashing and stretching. Motion is painted from
 * requestAnimationFrame at the display refresh, with frame-rate-independent
 * easing in JessicaAvatar. The voice level is a squash input, not a drawn feature.
 */
export const JESSICA_POSES = [
  "idle",
  "wake",
  "listen",
  "thinking",
  "speaking",
  "happy",
  "curious",
  "concerned",
  "engaged",
  "celebrate",
  "unavailable",
  "press",
] as const;

export type JessicaPose = (typeof JESSICA_POSES)[number];

export const JESSICA_ANIMATION = {
  driver: "requestAnimationFrame",
  targetFps: 60,
  easing: "exponential-lerp",
  body: "flat-blob",
} as const;

const CONCERNED = /didn.?t catch|sorry/;
const UNAVAILABLE = /unavailable|greeter/;
const CURIOUS = /\?|who else|timeline|biggest problem|involved|trying to solve/;

export function jessicaPose(status: string, caption: string, pressed = false): JessicaPose {
  const text = caption.toLowerCase().replace(/\s+/g, " ").trim();

  if (pressed && (status === "listening" || status === "ready")) return "press";
  if (status === "error" || status === "stopped" || UNAVAILABLE.test(text)) return "unavailable";
  if (CONCERNED.test(text)) return "concerned";
  if (status === "handoff" || text.includes("enter your details on the ipad")) return "celebrate";
  if (text.includes("i'm jessica") || text.startsWith("hi, i'm jessica") || text.startsWith("hi, i’m jessica")) {
    return "happy";
  }
  if (CURIOUS.test(text)) return "curious";
  if (status === "listening") return "listen";
  if (status === "thinking" || status === "connecting") return "thinking";
  if (status === "needs-start") return "wake";
  if (status === "speaking") {
    return text.length > 0 ? "engaged" : "speaking";
  }
  return "idle";
}

export type JessicaSprings = {
  bob: number;
  tilt: number;
  /** Positive widens and shortens the circle. Negative stretches it taller. */
  squash: number;
  lean: number;
  /** Eye openness. */
  eye: number;
  /** 0 is round. 1 flattens the eyes. */
  squint: number;
  /** Outward eye tilt used for a pleased shape. */
  cheer: number;
  /** Negative lifts the left eye. Positive lifts the right eye. */
  skew: number;
  /** Smoothed voice level. Drives squash while she is speaking. */
  voice: number;
};

export function poseSprings(pose: JessicaPose, mouthLevel: number): JessicaSprings {
  const talk = Math.max(0, Math.min(1, mouthLevel));
  switch (pose) {
    case "wake":
      return { bob: 0.45, tilt: -0.04, squash: -0.06, lean: 0, eye: 1, squint: 0.2, cheer: 0.25, skew: 0, voice: 0 };
    case "listen":
      return { bob: 0.28, tilt: -0.07, squash: -0.34, lean: 0.85, eye: 1.18, squint: 0, cheer: 0, skew: 0.15, voice: 0 };
    case "press":
      return { bob: 0.08, tilt: 0, squash: 0.78, lean: 0.15, eye: 1.12, squint: 0.12, cheer: 0.05, skew: 0, voice: 0 };
    case "thinking":
      return { bob: 0.12, tilt: -0.06, squash: -0.16, lean: 0, eye: 0.92, squint: 0.22, cheer: 0, skew: -0.85, voice: 0 };
    case "speaking":
      return { bob: 0.6, tilt: 0.02, squash: 0.12 + talk * 0.9, lean: 0.15, eye: 1, squint: 0.08, cheer: 0.12, skew: 0, voice: talk };
    case "happy":
      return { bob: 0.9, tilt: 0.05, squash: 0.22 + talk * 0.35, lean: 0, eye: 0.95, squint: 0.82, cheer: 1, skew: 0, voice: talk };
    case "curious":
      return { bob: 0.32, tilt: -0.12, squash: -0.46, lean: 0.35, eye: 1.16, squint: 0, cheer: 0, skew: 0.9, voice: talk };
    case "concerned":
      return { bob: 0.06, tilt: 0.04, squash: 0.4, lean: 0, eye: 0.62, squint: 0.7, cheer: 0, skew: 0, voice: talk * 0.35 };
    case "engaged":
      return { bob: 0.55, tilt: 0.03, squash: 0.08 + talk * 0.95, lean: 0.3, eye: 1.04, squint: 0.1, cheer: 0.18, skew: 0.1, voice: talk };
    case "celebrate":
      return { bob: 1, tilt: 0.1, squash: 0.18 + talk * 0.4, lean: 0, eye: 0.9, squint: 0.88, cheer: 1, skew: 0, voice: talk };
    case "unavailable":
      return { bob: 0, tilt: 0.02, squash: 0.2, lean: 0, eye: 0.38, squint: 0.55, cheer: 0, skew: 0, voice: 0 };
    case "idle":
    default:
      return { bob: 0.4, tilt: 0, squash: 0, lean: 0, eye: 1, squint: 0.04, cheer: 0.05, skew: 0, voice: 0 };
  }
}

/** 1 = eyes open. The first moment stays open so a still is not a blink. */
export function blinkOpen(time: number, pose: JessicaPose): number {
  if (pose === "wake") {
    const t = Math.min(1, Math.max(0, time / 0.7));
    return 0.2 + 0.8 * t * t * (3 - 2 * t);
  }
  if (time < 1.6) return 1;
  const period = pose === "unavailable" ? 5.8 : pose === "thinking" ? 2.8 : 3.7;
  const phase = time % period;
  const closeAt = period - 0.16;
  if (phase < closeAt) return 1;
  const u = (phase - closeAt) / 0.16;
  const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
  const shaped = tri * tri * (3 - 2 * tri);
  return 1 - shaped;
}

export function glanceOffset(time: number, pose: JessicaPose): { x: number; y: number } {
  if (pose === "curious") return { x: 0.55 + Math.sin(time * 0.8) * 0.12, y: -0.85 };
  if (pose === "thinking") return { x: -0.7, y: -0.75 };
  if (pose === "concerned" || pose === "unavailable") return { x: 0, y: 0.55 };
  if (pose === "listen" || pose === "press") return { x: 0.12, y: -0.15 };
  if (pose === "happy" || pose === "celebrate") return { x: Math.sin(time * 1.2) * 0.1, y: -0.25 };
  if (pose === "speaking" || pose === "engaged") return { x: Math.sin(time * 1.6) * 0.18, y: Math.sin(time * 2.1) * 0.08 };
  return { x: Math.sin(time * 0.37) * 0.42, y: Math.sin(time * 0.21) * 0.16 };
}

export function approach(current: number, target: number, dt: number, speed = 12): number {
  if (dt <= 0) return current;
  const gain = 1 - Math.exp(-speed * dt);
  return current + (target - current) * gain;
}
