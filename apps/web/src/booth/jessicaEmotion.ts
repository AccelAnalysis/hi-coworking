/**
 * Expression for the booth pebble. Chosen from the kiosk state and the line
 * Jessica is speaking. Visitor audio is not read here.
 */
export type JessicaEmotion = "calm" | "curious" | "engaged" | "happy" | "concerned";

const CONCERNED = /didn.?t catch|sorry|greeter|unavailable/;
const CURIOUS = /\?|who else|timeline|biggest problem|involved|trying to solve/;

export function jessicaEmotion(status: string, caption: string): JessicaEmotion {
  const text = caption.toLowerCase().replace(/\s+/g, " ").trim();

  if (status === "error" || status === "stopped" || CONCERNED.test(text)) return "concerned";
  if (status === "handoff" || text.includes("enter your details on the ipad")) return "happy";
  if (text.includes("i'm jessica") || text.startsWith("hi, i'm jessica") || text.startsWith("hi, i’m jessica")) return "happy";
  if (CURIOUS.test(text)) return "curious";
  if (status === "listening" || status === "thinking" || status === "connecting") return "curious";
  if (status === "speaking") return "engaged";
  return "calm";
}
