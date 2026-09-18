# Split — Voice & Music

A static JavaScript app that separates MP3 audio into **vocals** and **instrumental** tracks on your device. Includes local playback, separate stereo WAV downloads, progress, immediate worker cancellation, model caching, and a responsive interface. No account, application backend, or audio uploads. The page loads Google AdSense and Google Analytics, which make external requests for advertising and usage measurement.

## Run locally

From this folder:

```sh
python serve.py
```

Open **http://localhost:8080** in a recent desktop Chrome or Edge. Python only serves static files; decoding, AI inference, and WAV encoding all run in the browser. No Node, npm, or build step is needed. Any static HTTP server also works; HTTPS or localhost is required. Opening `index.html` as a `file://` URL is not supported.

The model has already been downloaded into this workspace. In a fresh checkout, either let the browser download it on the first separation, or download it for local hosting:

```sh
python download_model.py
```

The downloader verifies the pinned SHA-256. The model is 180,534,758 bytes (172.2 MiB), excluded from Git. The app tries `models/htdemucs.onnx` first and falls back to the revision-pinned Hugging Face URL only if the local file returns 404. Runtime JavaScript and WebAssembly are bundled in `vendor/ort/`, so separation needs no CDN. With the local model present, the audio-processing pipeline makes no external network requests; the page's advertising and analytics scripts still contact Google. Model cache storage may be unavailable or evicted by the browser; local hosting still works.

## Use

1. Drop an MP3 onto the page or browse for it. WAV and other browser-decodable audio formats also work.
2. Leave processing on **Auto** or choose **CPU** for compatibility.
3. Select **Separate voice & music**. The first run loads and caches the model.
4. Preview and download the two WAV tracks. Playing one preview pauses the others.

Inputs are limited to 100 MB and 10 minutes as a conservative guardrail, not a guarantee that every device can process that much. Start with a short clip. The browser decodes the entire input into memory; model activations and full-length output buffers also consume substantial RAM. Desktop hardware is recommended. CPU processing may be slower than the track's duration. Mobile inference and ten-minute tracks have not been benchmarked.

Output is stereo, 44.1 kHz, 16-bit PCM WAV. Mono input is duplicated to stereo; inputs with more than two channels are rejected. MP3 **input** is supported; MP3 **export** is not included. If either output exceeds full scale, both stems receive the same attenuation before encoding to avoid clipping and preserve their relative balance.

The model targets music vocals. Singing works best; speech over music and dense recordings can retain bleed or artifacts. This is not a guarantee of studio-quality isolation.

## How it works

- `app.js`: input validation, local decoding/resampling, accessible UI state, worker lifecycle, and object-URL cleanup.
- `separator.worker.js`: model fetch/cache, ONNX session, progress, inference, and WAV encoding away from the UI thread.
- `engine.js`: 7.8-second fixed model inputs with 25% overlap; combines time and frequency branches and blends overlapping estimates. Preserves the first/last sample and exact decoded duration, including clips shorter than one segment. Disposes per-segment tensors. The instrumental is the sum of drums, bass, and other stems.
- `audio.js`: shared peak gain and stereo PCM WAV serialization.
- `vendor/demucs/`: upstream FFT, spectral preprocessing, and reconstruction helpers. The upstream `DemucsProcessor` class is not used; chunk iteration is implemented in `engine.js` to handle short inputs, progress, boundaries, and tensor cleanup.
- `config.js`: model URLs, cache version, sample rate, and input limits.

Auto probes WebGPU in the worker, allows unsupported operators to use WASM, and retries session initialization on CPU if GPU initialization fails. Runtime inference failures surface an error with the CPU retry option. A GPU adapter being available does not mean every model operation runs on GPU.

## Static deployment

Publish the HTML, CSS, JavaScript modules, `vendor/`, and optionally `models/` to static HTTPS hosting. Include `README.md` for the credits link. Do not publish tests or their artifacts. No application server is required.

Serve `.js` and `.mjs` as JavaScript, `.wasm` as `application/wasm`, and `.onnx` as `application/octet-stream`. Use these headers to enable WASM threads:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`serve.py` sets both headers. `_headers` provides equivalent configuration for hosts that support that convention. Without isolation headers, the app uses one WASM thread. Keep missing-file responses as 404 rather than rewriting them to `index.html`, so the remote model fallback works. Some static hosts limit file sizes below the model's size; omit the local model there and use its remote URL. Changing to a different model requires matching preprocessing and tensor layouts, not just a URL change.

## Tests

```sh
python -m pip install playwright
python serve.py
# In a second terminal:
python tests/browser_test.py
python tests/edge_test.py
```

The test uses installed Chrome at the standard Windows path (adjust the executable path for other systems). It stubs Google advertising and analytics scripts to avoid recording test traffic. It runs actual ONNX inference, checks WAV headers/duration/stereo samples, resampling, cancellation/retry, model cache reuse/clear, no audio uploads or external audio-processing requests with a local model, overlap coverage, and desktop/mobile layout. Screenshots and generated fixtures go in ignored `tests/artifacts/`.

`edge_test.py` additionally checks corrupt audio, failed/truncated model downloads, recovery, mono 48 kHz resampling, and real inference on a host without isolation headers (single WASM thread).

Optional PowerShell example to test a real MP3:

```powershell
$env:TEST_AUDIO = 'C:\path\to\song.mp3'
$env:TEST_BACKEND = 'auto'
python tests/browser_test.py
```

Actual CPU inference was verified in Chrome on this Windows ARM machine with a stereo 22.05 kHz synthetic clip and a stereo MP3 spanning two model segments. The headless browser did not expose a usable GPU adapter, so Auto exercised CPU fallback; hardware GPU performance remains unverified. These are integration checks, not a perceptual-quality benchmark.

## Dependencies, provenance, and credits

- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/v1.22.0), version **1.22.0**, MIT. Pinned runtime and matching JSEP WebAssembly artifacts in `vendor/ort/`; license included. Browser deployment follows [ONNX Runtime documentation](https://onnxruntime.ai/docs/tutorials/web/deploy.html).
- [demucs-web](https://github.com/timcsy/demucs-web/tree/617385fbf5883b04a2e6f474be63ed4d93f4e44c), revision **617385fb…**, MIT. Unmodified helpers and license in `vendor/demucs/`.
- [Meta Demucs](https://github.com/facebookresearch/demucs), MIT; original license retained as `vendor/demucs/MODEL-LICENSE`.
- [Browser ONNX conversion](https://huggingface.co/timcsy/demucs-web-onnx), revision **92e33df6…**, distributed by the demucs-web author as HTDemucs. This conversion repository does not provide a separate model card or license declaration; the linked upstream project identifies Demucs and its MIT license. SHA-256: `e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077`.
- The optional MP3 used during development came from [Spleeter's demo](https://github.com/deezer/spleeter/blob/master/audio_example.mp3): *Slow Motion Dream* by Steven M Bryant, © 2011, featuring CSoul, Alex Beroza & Robert Siekawitch, [CC BY 3.0](http://dig.ccmixter.org/files/stevieb357/34740). It is not bundled with the app or required by the default test.
