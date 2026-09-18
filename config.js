// Revision-pinned model; all runtime code is served from this app's origin.
export const MODEL_URL = new URL('./models/htdemucs.onnx', import.meta.url).href;
export const MODEL_REMOTE_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx';
export const MODEL_CACHE = 'split-model-92e33df6-v1';
export const SAMPLE_RATE = 44100;
export const MAX_SECONDS = 600;
export const MAX_BYTES = 100 * 1024 * 1024;
