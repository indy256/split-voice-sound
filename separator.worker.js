import * as ort from './vendor/ort/ort.webgpu.min.mjs';
import { separate } from './engine.js';
import { encodeWav, sharedGain } from './audio.js';
import { MODEL_URL, MODEL_REMOTE_URL, MODEL_CACHE, SAMPLE_RATE } from './config.js';

const report = (status, progress = null, detail = '') => postMessage({ type: 'progress', status, progress, detail });

async function loadModel() {
  let cache;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* Private browsing may disable storage. */ }
  let cached;
  try { cached = cache && await cache.match(MODEL_URL); } catch { cache = null; }
  if (cached) {
    report('Loading cached model', null, 'Your audio stays on this device.');
    return cached.arrayBuffer();
  }
  report('Downloading separation model', 0, 'First run only: approximately 180 MB.');
  let response = await fetch(MODEL_URL);
  if (response.status === 404) response = await fetch(MODEL_REMOTE_URL);
  if (!response.ok) throw new Error(`Model download failed (${response.status}). Check your connection and try again.`);
  if (response.headers.get('content-type')?.includes('text/html')) throw new Error('Model URL returned a web page. Place htdemucs.onnx in the models folder or configure the host to return 404 for missing files.');
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0, lastReport = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    if (performance.now() - lastReport > 150) {
      report('Downloading separation model', total ? Math.min(loaded / total, 1) : null,
        `${(loaded / 1e6).toFixed(1)} MB${total ? ` of ${(total / 1e6).toFixed(1)} MB` : ''} downloaded`);
      lastReport = performance.now();
    }
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  chunks.length = 0;
  if (bytes.byteLength !== 180534758) throw new Error('The model download is incomplete or has the wrong size. Clear the model cache and retry.');
  if (cache) {
    try { await cache.put(MODEL_URL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
    catch { report('Model downloaded', 1, 'Browser storage is unavailable; the model will download again next time.'); }
  }
  return bytes.buffer;
}

self.onmessage = async ({ data }) => {
  let session;
  try {
    ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 2, 4) : 1;
    ort.env.wasm.proxy = false;
    let gpu = false;
    if (data.backend !== 'wasm' && navigator.gpu) {
      try { gpu = !!(await navigator.gpu.requestAdapter()); } catch { /* CPU fallback */ }
    }
    let model = await loadModel();
    const options = { graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false };
    report('Preparing the AI model', null, gpu ? 'Starting GPU acceleration…' : 'Starting CPU mode. This can be slow on long tracks.');
    try {
      session = await ort.InferenceSession.create(model, { ...options, executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] });
    } catch (error) {
      if (!gpu) throw error;
      report('Switching to CPU mode', null, 'GPU initialization was unavailable on this device.');
      gpu = false;
      session = await ort.InferenceSession.create(model, { ...options, executionProviders: ['wasm'] });
    }
    model = null;
    if (session.inputNames.length !== 2) throw new Error('Unexpected model inputs. Clear the model cache and try again.');
    const started = performance.now();
    report('Separating voice & music', 0, `${gpu ? 'GPU preferred' : 'CPU mode'} · The first segment may take longer.`);
    const result = await separate(ort, session, data.left, data.right, (progress, current, total) => {
      const seconds = (performance.now() - started) / 1000;
      const remaining = Math.ceil(seconds / current * (total - current));
      report('Separating voice & music', progress, `Segment ${current} of ${total}${remaining ? ` · about ${remaining < 60 ? remaining + ' seconds' : Math.ceil(remaining / 60) + ' minutes'} remaining` : ''}`);
    });
    report('Preparing your downloads', null, 'Encoding stereo WAV files on your device.');
    const gain = sharedGain([result.voice, result.music]);
    const voice = encodeWav(result.voice, SAMPLE_RATE, gain);
    const music = encodeWav(result.music, SAMPLE_RATE, gain);
    await session.release(); session = null;
    postMessage({ type: 'done', voice, music, gain, seconds: (performance.now() - started) / 1000 }, [voice, music]);
  } catch (error) {
    console.error(error);
    postMessage({ type: 'error', message: `${error.message || error}. Try a shorter clip or CPU compatibility mode. If model loading keeps failing, clear the model cache.` });
  } finally {
    if (session) await session.release().catch(() => {});
  }
};
