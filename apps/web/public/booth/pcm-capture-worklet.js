class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.held = false;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "hold") this.held = Boolean(data.value);
      if (data.type === "flush") {
        this.held = false;
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs) {
    if (!this.held) return true;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    const copy = new Float32Array(channel);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
