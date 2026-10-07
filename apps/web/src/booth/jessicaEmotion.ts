/**
 * Jessica's expression library. The face is a soft pebble: big eyes, rounded
 * chin, no cleft. Motion is painted from requestAnimationFrame at the display
 * refresh, with frame-rate-independent easing in JessicaAvatar.
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
  chin: "smooth-ellipse",
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
  smile: number;
  mouth: number;
  squash: number;
  brow: number;
  lean: number;
  eye: number;
};

export function poseSprings(pose: JessicaPose, mouthLevel: number): JessicaSprings {
  const talk = Math.max(0, Math.min(1, mouthLevel));
  switch (pose) {
    case "wake":
      return { bob: 0.4, tilt: -0.04, smile: 0.62, mouth: 0.05, squash: 0, brow: 0.15, lean: 0, eye: 1 };
    case "listen":
      return { bob: 0.15, tilt: -0.08, smile: 0.28, mouth: 0.04, squash: 0, brow: 0.25, lean: 1, eye: 1.08 };
    case "press":
      return { bob: 0.05, tilt: 0, smile: 0.2, mouth: 0.08, squash: 1, brow: 0.35, lean: 0.4, eye: 1.14 };
    case "thinking":
      return { bob: 0.08, tilt: -0.05, smile: 0.08, mouth: 0.12, squash: 0, brow: 0.85, lean: 0, eye: 0.92 };
    case "speaking":
      return { bob: 0.2, tilt: 0.02, smile: 0.4, mouth: 0.25 + talk * 0.75, squash: 0, brow: 0.1, lean: 0.2, eye: 1 };
    case "happy":
      return { bob: 0.7, tilt: 0.05, smile: 0.95, mouth: 0.12 + talk * 0.55, squash: 0, brow: 0.2, lean: 0, eye: 0.86 };
    case "curious":
      return { bob: 0.25, tilt: -0.14, smile: 0.18, mouth: Math.max(0.22, talk), squash: 0, brow: 1, lean: 0.3, eye: 1.16 };
    case "concerned":
      return { bob: 0.05, tilt: 0.06, smile: -0.42, mouth: talk * 0.35, squash: 0, brow: -0.8, lean: 0, eye: 0.74 };
    case "engaged":
      return { bob: 0.3, tilt: 0.03, smile: 0.55, mouth: 0.2 + talk * 0.8, squash: 0, brow: 0.15, lean: 0.35, eye: 1.02 };
    case "celebrate":
      return { bob: 1, tilt: 0.08, smile: 1, mouth: 0.18 + talk * 0.45, squash: 0.15, brow: 0.25, lean: 0, eye: 0.84 };
    case "unavailable":
      return { bob: 0, tilt: 0.03, smile: -0.22, mouth: 0, squash: 0, brow: -0.35, lean: 0, eye: 0.58 };
    case "idle":
    default:
      return { bob: 0.22, tilt: 0, smile: 0.48, mouth: 0, squash: 0, brow: 0, lean: 0, eye: 1 };
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
  if (pose === "curious") return { x: 0.35 + Math.sin(time * 0.8) * 0.15, y: -0.8 };
  if (pose === "thinking") return { x: -0.75, y: -0.85 };
  if (pose === "concerned" || pose === "unavailable") return { x: 0, y: 0.4 };
  if (pose === "listen" || pose === "press") return { x: 0.1, y: -0.05 };
  if (pose === "happy" || pose === "celebrate") return { x: Math.sin(time * 1.2) * 0.12, y: -0.2 };
  return { x: Math.sin(time * 0.37) * 0.38, y: Math.sin(time * 0.21) * 0.12 };
}

export function approach(current: number, target: number, dt: number, speed = 12): number {
  if (dt <= 0) return current;
  const gain = 1 - Math.exp(-speed * dt);
  return current + (target - current) * gain;
}
