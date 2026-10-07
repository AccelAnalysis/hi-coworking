"use client";

import { useCallback, useRef, useState } from "react";
import {
  GREETING_LINE,
  HANDOFF_LINE,
  REALTIME_WS_URL,
  STT_RETRY_LINE,
  STT_STOP_LINE,
  applyTranscriptResult,
  boothTokenUrl,
  buildForceMessage,
  buildResponseCreate,
  buildSessionUpdate,
  classifyTranscript,
  handoffDetected,
  isBrowserSafeClientSecret,
  nextDiscoveryStep,
  parseClientSecret,
  readAssistantTranscript,
  readTranscript,
  scrubAssistantCaption,
  type DiscoveryStep,
  type ListenMode,
} from "@/booth/jessicaSession";
import {
  JESSICA_SAMPLE_RATE,
  base64Pcm16ToFloat32,
  floatToPcm16,
  pcm16ToBase64,
  resampleLinear,
  rms,
} from "@/booth/pcm";
export type KioskStatus =
  | "needs-start"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "stopped"
  | "handoff"
  | "error";

type ScriptedKind = "greet" | "retry" | "stop" | null;
type AfterAudio = "ready" | "stopped" | "handoff" | null;

const SHORT_HOLD_MS = 300;
const TRANSCRIPT_WAIT_MS = 5000;
const RESET_AFTER_MS = 8000;

class PcmPlayer {
  private sources: AudioBufferSourceNode[] = [];
  private nextTime = 0;
  private active = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly onLevel: (level: number) => void,
    private readonly onIdle: () => void,
  ) {}

  get playing() {
    return this.active > 0;
  }

  enqueue(samples: Float32Array) {
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, JESSICA_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.02, this.nextTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
    this.sources.push(source);
    this.active += 1;
    this.onLevel(Math.min(1, rms(samples) * 5));
    source.onended = () => {
      this.active = Math.max(0, this.active - 1);
      this.sources = this.sources.filter((item) => item !== source);
      if (this.active === 0) {
        this.onLevel(0);
        this.onIdle();
      }
    };
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
    this.active = 0;
    this.nextTime = 0;
    this.onLevel(0);
  }
}

function isMicProblem(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError" || error.name === "SecurityError" || error.name === "NotReadableError");
}

export function useJessicaVoice() {
  const [status, setStatusState] = useState<KioskStatus>("needs-start");
  const [caption, setCaption] = useState("");
  const [mouth, setMouth] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [vadFallback, setVadFallbackState] = useState(false);

  const statusRef = useRef<KioskStatus>("needs-start");
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const generationRef = useRef(0);
  const modeRef = useRef<ListenMode>("ptt");
  const stepRef = useRef<DiscoveryStep>("problem");
  const failuresRef = useRef(0);
  const greetedRef = useRef(false);
  const holdingRef = useRef(false);
  const captureRef = useRef<"off" | "live" | "flushing">("off");
  const pendingMicRef = useRef<Float32Array>(new Float32Array(0));
  const framesRef = useRef(0);
  const holdStartedRef = useRef(0);
  const waitingTranscriptRef = useRef(false);
  const transcriptTimerRef = useRef<number | null>(null);
  const assistantTextRef = useRef("");
  const scriptedRef = useRef<ScriptedKind>(null);
  const afterAudioRef = useRef<AfterAudio>(null);
  const resetTimerRef = useRef<number | null>(null);
  const responseOpenRef = useRef(false);
  const latestVisitorRef = useRef("");

  const setStatus = useCallback((next: KioskStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const clearTranscriptWait = useCallback(() => {
    waitingTranscriptRef.current = false;
    if (transcriptTimerRef.current !== null) {
      window.clearTimeout(transcriptTimerRef.current);
      transcriptTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    generationRef.current += 1;
    clearTranscriptWait();
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    playerRef.current?.stop();
    playerRef.current = null;
    workletRef.current?.port.postMessage({ type: "hold", value: false });
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    holdingRef.current = false;
    captureRef.current = "off";
    pendingMicRef.current = new Float32Array(0);
  }, [clearTranscriptWait]);

  const armReset = useCallback(() => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      teardown();
      stepRef.current = "problem";
      failuresRef.current = 0;
      greetedRef.current = false;
      assistantTextRef.current = "";
      scriptedRef.current = null;
      afterAudioRef.current = null;
      responseOpenRef.current = false;
      setCaption("");
      setMouth(0);
      setErrorMessage(null);
      setStatus("needs-start");
    }, RESET_AFTER_MS);
  }, [setStatus, teardown]);

  const applyAfterAudio = useCallback(() => {
    const next = afterAudioRef.current;
    if (!next) {
      if (statusRef.current === "speaking") setStatus("ready");
      return;
    }
    afterAudioRef.current = null;
    if (next === "ready") setStatus("ready");
    if (next === "stopped") {
      setStatus("stopped");
      setCaption(STT_STOP_LINE);
      armReset();
    }
    if (next === "handoff") {
      setStatus("handoff");
      armReset();
    }
  }, [armReset, setStatus]);

  const showCaption = useCallback((text: string) => {
    const clean = scrubAssistantCaption(text);
    if (clean) setCaption(clean);
  }, []);

  const finishScripted = useCallback((kind: ScriptedKind) => {
    scriptedRef.current = null;
    if (kind === "stop") afterAudioRef.current = "stopped";
    else afterAudioRef.current = "ready";
    if (!playerRef.current?.playing) applyAfterAudio();
  }, [applyAfterAudio]);

  const enterHandoff = useCallback((text: string) => {
    showCaption(text || HANDOFF_LINE);
    afterAudioRef.current = "handoff";
    if (!playerRef.current?.playing) applyAfterAudio();
    else setStatus("speaking");
  }, [applyAfterAudio, setStatus, showCaption]);

  const resolveTranscript = useCallback((kind: "usable" | "empty") => {
    if (!waitingTranscriptRef.current && modeRef.current === "ptt") return;
    latestVisitorRef.current = "";
    clearTranscriptWait();
    const outcome = applyTranscriptResult(failuresRef.current, kind);
    failuresRef.current = outcome.failures;

    if (modeRef.current === "vad") {
      if (outcome.action === "respond") return;
      send({ type: "response.cancel" });
      playerRef.current?.stop();
      if (outcome.action === "retry") {
        scriptedRef.current = "retry";
        showCaption(STT_RETRY_LINE);
        send(buildForceMessage(STT_RETRY_LINE));
        setStatus("speaking");
        return;
      }
      scriptedRef.current = "stop";
      showCaption(STT_STOP_LINE);
      send(buildForceMessage(STT_STOP_LINE));
      setStatus("speaking");
      return;
    }

    if (outcome.action === "respond") {
      const step = stepRef.current;
      if (!responseOpenRef.current) send(buildResponseCreate(step));
      stepRef.current = nextDiscoveryStep(step);
      setStatus("thinking");
      return;
    }
    if (outcome.action === "retry") {
      scriptedRef.current = "retry";
      showCaption(STT_RETRY_LINE);
      send(buildForceMessage(STT_RETRY_LINE));
      setStatus("speaking");
      return;
    }
    scriptedRef.current = "stop";
    showCaption(STT_STOP_LINE);
    send(buildForceMessage(STT_STOP_LINE));
    setStatus("speaking");
  }, [clearTranscriptWait, send, setStatus, showCaption]);

  const armTranscriptWait = useCallback(() => {
    waitingTranscriptRef.current = true;
    if (transcriptTimerRef.current !== null) window.clearTimeout(transcriptTimerRef.current);
    transcriptTimerRef.current = window.setTimeout(() => {
      const kind = classifyTranscript(latestVisitorRef.current);
      resolveTranscript(kind);
    }, TRANSCRIPT_WAIT_MS);
  }, [resolveTranscript]);

  const appendMic = useCallback((samples: Float32Array, inputRate: number) => {
    const resampled = resampleLinear(samples, inputRate, JESSICA_SAMPLE_RATE);
    const merged = new Float32Array(pendingMicRef.current.length + resampled.length);
    merged.set(pendingMicRef.current);
    merged.set(resampled, pendingMicRef.current.length);
    let pending = merged;
    const chunk = 2400;
    while (pending.length >= chunk) {
      const slice = pending.subarray(0, chunk);
      framesRef.current += slice.length;
      send({ type: "input_audio_buffer.append", audio: pcm16ToBase64(floatToPcm16(slice)) });
      pending = pending.slice(chunk);
    }
    pendingMicRef.current = pending;
  }, [send]);

  const flushMic = useCallback(() => {
    const pending = pendingMicRef.current;
    pendingMicRef.current = new Float32Array(0);
    if (pending.length > 0) {
      framesRef.current += pending.length;
      send({ type: "input_audio_buffer.append", audio: pcm16ToBase64(floatToPcm16(pending)) });
    }
  }, [send]);

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "session.updated" && !greetedRef.current) {
      greetedRef.current = true;
      scriptedRef.current = "greet";
      showCaption(GREETING_LINE);
      send(buildForceMessage(GREETING_LINE));
      setStatus("speaking");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped" && modeRef.current === "vad") {
      armTranscriptWait();
      setStatus("thinking");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed" || type === "conversation.item.input_audio_transcription.updated") {
      const heard = readTranscript(event);
      if (heard.trim()) latestVisitorRef.current = heard;
      if (type.endsWith("updated")) return;
      const finalText = heard.trim() ? heard : latestVisitorRef.current;
      resolveTranscript(classifyTranscript(finalText));
      return;
    }

    if (type === "response.created") {
      responseOpenRef.current = true;
      assistantTextRef.current = "";
      if (statusRef.current !== "stopped" && statusRef.current !== "handoff") setStatus("speaking");
      return;
    }

    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) return;
      void contextRef.current?.resume();
      playerRef.current?.enqueue(base64Pcm16ToFloat32(delta));
      if (statusRef.current === "thinking" || statusRef.current === "ready") setStatus("speaking");
      return;
    }

    if (type === "response.output_audio_transcript.done") {
      const text = readAssistantTranscript(event, assistantTextRef.current);
      assistantTextRef.current = text;
      if (!scriptedRef.current) showCaption(text);
      return;
    }

    if (type === "response.done") {
      responseOpenRef.current = false;
      const scripted = scriptedRef.current;
      if (scripted) {
        finishScripted(scripted);
        return;
      }
      const spoken = readAssistantTranscript(event, assistantTextRef.current);
      if (spoken) assistantTextRef.current = spoken;
      if (!scriptedRef.current && spoken) showCaption(spoken);
      if (stepRef.current === "confirm" || stepRef.current === "done" || handoffDetected(spoken)) {
        enterHandoff(spoken || HANDOFF_LINE);
        return;
      }
      afterAudioRef.current = "ready";
      if (!playerRef.current?.playing) applyAfterAudio();
      return;
    }

    if (type === "response.output_audio_transcript.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      assistantTextRef.current += delta;
      return;
    }

    if (type === "error") {
      if (waitingTranscriptRef.current) {
        resolveTranscript("empty");
        return;
      }
      if (!greetedRef.current) {
        setErrorMessage("Voice service is unavailable. A greeter and the iPad can still help.");
        setStatus("error");
      }
    }
  }, [applyAfterAudio, armTranscriptWait, enterHandoff, finishScripted, resolveTranscript, send, setStatus, showCaption]);

  const reset = useCallback(() => {
    teardown();
    stepRef.current = "problem";
    failuresRef.current = 0;
    greetedRef.current = false;
    assistantTextRef.current = "";
    scriptedRef.current = null;
    afterAudioRef.current = null;
    responseOpenRef.current = false;
    setCaption("");
    setMouth(0);
    setErrorMessage(null);
    setStatus("needs-start");
  }, [setStatus, teardown]);

  const start = useCallback(() => {
    if (statusRef.current !== "needs-start" && statusRef.current !== "error") return;
    teardown();
    setErrorMessage(null);
    setStatus("connecting");
    const generation = generationRef.current;
    stepRef.current = "problem";
    failuresRef.current = 0;
    greetedRef.current = false;
    assistantTextRef.current = "";
    responseOpenRef.current = false;

    const context = new AudioContext({ latencyHint: "interactive" });
    contextRef.current = context;
    void context.resume();
    const micPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    void (async () => {
      try {
        const [tokenResponse, stream] = await Promise.all([
          fetch(boothTokenUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }),
          micPromise,
        ]);
        if (generationRef.current !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (!tokenResponse.ok) throw new Error("token");
        const secret = parseClientSecret(await tokenResponse.json());
        if (!secret || !isBrowserSafeClientSecret(secret.value)) throw new Error("token");
        if (generationRef.current !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        await context.audioWorklet.addModule("/booth/pcm-capture-worklet.js");
        if (generationRef.current !== generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const source = context.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(context, "pcm-capture");
        source.connect(worklet);
        workletRef.current = worklet;
        playerRef.current = new PcmPlayer(context, setMouth, () => {
          if (generationRef.current !== generation) return;
          applyAfterAudio();
        });

        worklet.port.onmessage = (message) => {
          if (generationRef.current !== generation) return;
          const data = message.data;
          if (data && typeof data === "object" && "type" in data && data.type === "flushed") {
            flushMic();
            const elapsed = performance.now() - holdStartedRef.current;
            const enough = elapsed >= SHORT_HOLD_MS && framesRef.current >= 2400;
            captureRef.current = "off";
            holdingRef.current = false;
            if (!enough) {
              send({ type: "input_audio_buffer.clear" });
              framesRef.current = 0;
              if (statusRef.current === "listening") setStatus("ready");
              setCaption("Hold the button while you speak.");
              return;
            }
            send({ type: "input_audio_buffer.commit" });
            setStatus("thinking");
            armTranscriptWait();
            return;
          }
          if (data instanceof Float32Array && (captureRef.current === "live" || captureRef.current === "flushing")) {
            appendMic(data, context.sampleRate);
          }
        };

        const socket = new WebSocket(REALTIME_WS_URL, [`xai-client-secret.${secret.value}`]);
        socketRef.current = socket;
        socket.addEventListener("open", () => {
          if (generationRef.current !== generation) return;
          send(buildSessionUpdate(modeRef.current));
          if (modeRef.current === "vad") worklet.port.postMessage({ type: "hold", value: true });
        });
        socket.addEventListener("message", (message) => {
          if (generationRef.current !== generation || typeof message.data !== "string") return;
          try {
            const event = JSON.parse(message.data) as Record<string, unknown>;
            handleEvent(event);
          } catch {
            setErrorMessage("Voice service is unavailable. A greeter and the iPad can still help.");
            setStatus("error");
          }
        });
        socket.addEventListener("close", () => {
          if (generationRef.current !== generation) return;
          if (statusRef.current === "connecting" || statusRef.current === "ready" || statusRef.current === "speaking" || statusRef.current === "listening" || statusRef.current === "thinking") {
            setErrorMessage("Voice service is unavailable. A greeter and the iPad can still help.");
            setStatus("error");
          }
        });
        socket.addEventListener("error", () => {
          if (generationRef.current !== generation) return;
          setErrorMessage("Voice service is unavailable. A greeter and the iPad can still help.");
          setStatus("error");
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        if (isMicProblem(error)) {
          setErrorMessage("The booth microphone is unavailable. A greeter and the iPad can still help.");
        } else {
          setErrorMessage("Voice service is unavailable. A greeter and the iPad can still help.");
        }
        setStatus("error");
      }
    })();
  }, [appendMic, applyAfterAudio, armTranscriptWait, flushMic, handleEvent, send, setStatus, teardown]);

  const pttDown = useCallback(() => {
    if (modeRef.current === "vad") return;
    const current = statusRef.current;
    if (current === "needs-start" || current === "connecting" || current === "error" || current === "stopped" || current === "handoff") return;
    if (stepRef.current === "confirm" || stepRef.current === "done") return;
    if (holdingRef.current) return;
    holdingRef.current = true;
    captureRef.current = "live";
    framesRef.current = 0;
    pendingMicRef.current = new Float32Array(0);
    latestVisitorRef.current = "";
    holdStartedRef.current = performance.now();
    clearTranscriptWait();
    if (responseOpenRef.current) send({ type: "response.cancel" });
    playerRef.current?.stop();
    afterAudioRef.current = null;
    send({ type: "input_audio_buffer.clear" });
    workletRef.current?.port.postMessage({ type: "hold", value: true });
    setStatus("listening");
    setCaption("");
  }, [clearTranscriptWait, send, setStatus]);

  const pttUp = useCallback(() => {
    if (!holdingRef.current || modeRef.current === "vad") return;
    captureRef.current = "flushing";
    workletRef.current?.port.postMessage({ type: "flush" });
  }, []);

  const setVadFallback = useCallback((enabled: boolean) => {
    setVadFallbackState(enabled);
    modeRef.current = enabled ? "vad" : "ptt";
    if (socketRef.current?.readyState === WebSocket.OPEN) send(buildSessionUpdate(modeRef.current));
    if (enabled) {
      holdingRef.current = false;
      captureRef.current = "live";
      workletRef.current?.port.postMessage({ type: "hold", value: true });
      if (statusRef.current === "ready") setStatus("listening");
      return;
    }
    captureRef.current = "off";
    workletRef.current?.port.postMessage({ type: "hold", value: false });
    send({ type: "input_audio_buffer.clear" });
    if (statusRef.current === "listening") setStatus("ready");
  }, [send, setStatus]);

  return {
    status,
    caption,
    mouth,
    errorMessage,
    vadFallback,
    setVadFallback,
    start,
    reset,
    pttDown,
    pttUp,
  };
}
