import { CONSTANTS } from './vendor/demucs/constants.js';
import { prepareModelInput, standaloneMask, standaloneIspec } from './vendor/demucs/processor.js';

const N = CONSTANTS.TRAINING_SAMPLES;
const stride = Math.floor(N * (1 - CONSTANTS.SEGMENT_OVERLAP));

export function segmentStarts(length) {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('Audio is empty.');
  const starts = [0];
  while (starts[starts.length - 1] + N < length) starts.push(starts[starts.length - 1] + stride);
  return starts;
}

export function blendWeight(i, length, first, last) {
  const overlap = N - stride;
  return Math.min(first ? 1 : (i + 1) / overlap, last ? 1 : (length - i) / overlap, 1);
}

export async function separate(ort, session, left, right, onProgress) {
  if (left.length !== right.length) throw new Error('Channel lengths do not match.');
  const starts = segmentStarts(left.length);
  const track = () => ({ left: new Float32Array(left.length), right: new Float32Array(left.length) });
  const voice = track(), music = track(), weights = new Float32Array(left.length);
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s], length = Math.min(N, left.length - start);
    const input = prepareModelInput(left.subarray(start, start + length), right.subarray(start, start + length));
    const waveform = new ort.Tensor('float32', input.waveform, [1, 2, N]);
    const spectrum = new ort.Tensor('float32', input.magSpec, [1, 4, CONSTANTS.MODEL_SPEC_BINS, CONSTANTS.MODEL_SPEC_FRAMES]);
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: waveform, [session.inputNames[1]]: spectrum });
      const time = Object.values(outputs).find(t => t.dims.length === 4 && t.dims[1] === 4 && t.dims[2] === 2);
      const freq = Object.values(outputs).find(t => t.dims.length === 5 && t.dims[1] === 4 && t.dims[2] === 4);
      if (!time || !freq || time.dims[3] !== N) throw new Error('Unexpected separation model output.');
      const specs = standaloneMask(freq.data);
      for (let t = 0; t < 4; t++) {
        const frequency = standaloneIspec(specs[t], N);
        const target = t === 3 ? voice : music;
        for (let i = 0; i < length; i++) {
          const weight = blendWeight(i, length, s === 0, s === starts.length - 1);
          target.left[start + i] += (time.data[t * 2 * N + i] + frequency.left[i]) * weight;
          target.right[start + i] += (time.data[(t * 2 + 1) * N + i] + frequency.right[i]) * weight;
        }
      }
      for (let i = 0; i < length; i++) weights[start + i] += blendWeight(i, length, s === 0, s === starts.length - 1);
    } finally {
      waveform.dispose(); spectrum.dispose();
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    }
    onProgress((s + 1) / starts.length, s + 1, starts.length);
  }
  for (let i = 0; i < left.length; i++) {
    voice.left[i] /= weights[i]; voice.right[i] /= weights[i];
    music.left[i] /= weights[i]; music.right[i] /= weights[i];
  }
  return { voice, music };
}
