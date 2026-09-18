// PCM16 WAV, with one shared gain for both stems to preserve their balance.
export function sharedGain(tracks) {
  let peak = 1;
  for (const track of tracks) for (const channel of [track.left, track.right]) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new Error('The model returned invalid audio. Try CPU compatibility mode.');
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak > 1 ? 0.999 / peak : 1;
}

export function encodeWav({ left, right }, sampleRate, gain = 1) {
  if (left.length !== right.length) throw new Error('Channel lengths do not match.');
  const buffer = new ArrayBuffer(44 + left.length * 4);
  const view = new DataView(buffer);
  const word = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, left.length * 4, true);
  for (let i = 0; i < left.length; i++) for (let c = 0; c < 2; c++) {
    const value = Math.max(-1, Math.min(1, (c ? right[i] : left[i]) * gain));
    view.setInt16(44 + i * 4 + c * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
