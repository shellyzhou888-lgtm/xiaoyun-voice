class XiaoyunCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0; this.sum = 0;
    this.packet = new Int16Array(1600); this.pos = 0;
    this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let left = 1;
      while (left > 0.00001) {
        const take = Math.min(left, this.ratio - this.weight);
        this.sum += sample * take; this.weight += take; left -= take;
        if (this.weight >= this.ratio - 0.00001) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.packet[this.pos++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.energy += value * value;
          this.weight = 0; this.sum = 0;
          if (this.pos === this.packet.length) {
            this.port.postMessage({pcm:this.packet.buffer, rms:Math.sqrt(this.energy / this.pos)}, [this.packet.buffer]);
            this.packet = new Int16Array(1600); this.pos = 0; this.energy = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('xiaoyun-capture', XiaoyunCapture);
