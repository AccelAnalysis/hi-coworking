/**
 * Booth script and turn rules for the NASA Expo Jessica kiosk.
 * Visitor speech stays inside the xAI voice session. This module never
 * writes to Attio, Firestore, local storage, or logs.
 */

export const REALTIME_MODEL = "grok-voice-latest";
export const REALTIME_WS_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_MODEL}`;
export const CLIENT_SECRET_URL = "https://api.x.ai/v1/realtime/client_secrets";
export const CLIENT_SECRET_TTL_SECONDS = 300;
export const DEFAULT_BOOTH_TOKEN_URL =
  "https://us-central1-hi-coworking-plat.cloudfunctions.net/booth_mintVoiceClientSecret";
export const IPAD_FORM_PATH = "/expo/nasa-2026";

export const HANDOFF_LINE =
  "Please enter your details on the iPad so our team can follow up the way you prefer.";
export const GREETING_LINE =
  "Hi, I'm Jessica, the Accel Analysis booth assistant. What's the biggest problem you're trying to solve this quarter?";
export const STT_RETRY_LINE =
  "I didn't catch that. Press and hold the button and try once more.";
export const STT_STOP_LINE =
  "I'm sorry, I didn't catch that. A greeter and the iPad will help you from here.";

export const STT_FAILURE_LIMIT = 2;
export const JESSICA_VOICE = "eve";

export const JESSICA_INSTRUCTIONS = `You are Jessica, the Accel Analysis booth assistant at the NASA Expo. Speak in one or two short sentences. The room is noisy.

You already greeted the visitor and asked about their biggest problem this quarter. Continue in order, one question at a time: who else is involved, then their timeline. After those answers, restate their need in their words without adding anything they did not say, then say exactly: "${HANDOFF_LINE}" Stop after that sentence.

If you did not understand them, say so and ask them to press and hold the button and try once more. Never invent a problem, a timeline, stakeholders, or a next step.

Never ask for a name, email address, phone number, or any other contact detail. If they volunteer any of those, do not repeat them. The iPad is where contact details go. Do not mention Attio, databases, recordings, or internal tools. Do not promise pricing, legal terms, or procurement outcomes. If you cannot answer, point them to a greeter and the iPad.`;

export type ListenMode = "ptt" | "vad";
export type DiscoveryStep = "problem" | "stakeholders" | "timeline" | "confirm" | "done";
export type TranscriptKind = "usable" | "empty";
export type TranscriptAction = "respond" | "retry" | "stop";

export function boothTokenUrl(envValue: string | undefined = process.env.NEXT_PUBLIC_BOOTH_TOKEN_URL): string {
  const configured = envValue?.trim();
  return configured || DEFAULT_BOOTH_TOKEN_URL;
}

export function buildClientSecretBody(): { expires_after: { seconds: number } } {
  return { expires_after: { seconds: CLIENT_SECRET_TTL_SECONDS } };
}

export function parseClientSecret(payload: unknown): { value: string; expires_at: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.value !== "string" || record.value.length < 8) return null;
  if (typeof record.expires_at !== "number" || !Number.isFinite(record.expires_at)) return null;
  return { value: record.value, expires_at: record.expires_at };
}

/** Browser WebSocket subprotocols reject separator characters such as spaces. */
export function isBrowserSafeClientSecret(value: string): boolean {
  return /^[A-Za-z0-9._~+-]+$/.test(value);
}

export function buildSessionUpdate(mode: ListenMode) {
  return {
    type: "session.update" as const,
    session: {
      voice: JESSICA_VOICE,
      instructions: JESSICA_INSTRUCTIONS,
      reasoning: { effort: "none" as const },
      turn_detection: mode === "vad" ? { type: "server_vad" as const } : null,
      audio: {
        input: {
          format: { type: "audio/pcm" as const, rate: 24000 },
          transcription: {
            model: "grok-transcribe",
            language_hint: "en",
            keyterms: ["Accel Analysis", "NASA", "Jessica", "iPad"],
          },
        },
        output: {
          format: { type: "audio/pcm" as const, rate: 24000 },
        },
      },
    },
  };
}

export function buildForceMessage(text: string) {
  return {
    type: "conversation.item.create" as const,
    item: {
      type: "force_message" as const,
      role: "assistant" as const,
      interruptible: false,
      content: [{ type: "output_text" as const, text }],
    },
  };
}

export function instructionsForAnsweredStep(step: DiscoveryStep): string {
  switch (step) {
    case "problem":
      return "Ask only who else is involved in the problem they just described. One short sentence. Do not ask for a name, email address, or phone number. Do not repeat any contact detail they volunteered.";
    case "stakeholders":
      return "Ask only about their timeline. One short sentence. Do not ask for a name, email address, or phone number. Do not repeat any contact detail they volunteered.";
    case "timeline":
    case "confirm":
    case "done":
      return `In one short sentence, restate the need they described using their words, and do not add anything they did not say. Then say exactly: "${HANDOFF_LINE}" Do not ask another question. Do not repeat any name, email address, or phone number.`;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

export function buildResponseCreate(step: DiscoveryStep) {
  return {
    type: "response.create" as const,
    response: {
      instructions: instructionsForAnsweredStep(step),
    },
  };
}

export function nextDiscoveryStep(step: DiscoveryStep): DiscoveryStep {
  if (step === "problem") return "stakeholders";
  if (step === "stakeholders") return "timeline";
  if (step === "timeline") return "confirm";
  return "done";
}

export function classifyTranscript(transcript: string): TranscriptKind {
  const letters = transcript.replace(/[^a-z0-9]/gi, "");
  return letters.length >= 2 ? "usable" : "empty";
}

/**
 * Two unusable transcripts in a row end the voice loop. A usable turn
 * clears the streak so one noisy moment does not end a later conversation.
 */
export function applyTranscriptResult(
  failures: number,
  kind: TranscriptKind,
): { failures: number; action: TranscriptAction } {
  if (kind === "usable") return { failures: 0, action: "respond" };
  const next = failures + 1;
  if (next >= STT_FAILURE_LIMIT) return { failures: next, action: "stop" };
  return { failures: next, action: "retry" };
}

export function handoffDetected(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized.includes(HANDOFF_LINE.toLowerCase());
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/** Drop contact details from Jessica's on-screen line. The TV is public. */
export function scrubAssistantCaption(text: string): string {
  return text
    .replace(EMAIL_PATTERN, "")
    .replace(PHONE_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

export function readTranscript(event: Record<string, unknown>): string {
  if (typeof event.transcript === "string") return event.transcript;
  const item = event.item;
  if (!item || typeof item !== "object") return "";
  const content = (item as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    })
    .filter(Boolean)
    .join(" ");
}

export function readAssistantTranscript(event: Record<string, unknown>, accumulated: string): string {
  if (typeof event.transcript === "string" && event.transcript.trim()) return event.transcript;
  return accumulated;
}
