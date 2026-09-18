import { MODEL_CACHE, SAMPLE_RATE, MAX_SECONDS, MAX_BYTES } from './config.js';

const $ = id => document.getElementById(id);
let file = null, worker = null, busy = false, generation = 0;
let originalURL = null, resultURLs = [];
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function status(text, progress = null, detail = '') {
  $('status-area').hidden = false;
  $('status').textContent = text;
  $('detail').textContent = detail;
  if (progress === null) { $('progress').removeAttribute('value'); $('percent').textContent = ''; }
  else { $('progress').value = progress; $('percent').textContent = `${Math.round(progress * 100)}%`; }
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  for (const id of ['file', 'replace', 'backend', 'clear-cache']) $(id).disabled = value;
  $('separate').disabled = value || !file;
  $('cancel').hidden = !value;
}
function resetResults() {
  $('results').hidden = true;
  for (const id of ['voice-player', 'music-player']) { $(id).pause(); $(id).removeAttribute('src'); $(id).load(); }
  for (const url of resultURLs) URL.revokeObjectURL(url);
  resultURLs = [];
}
function selectFile(next) {
  if (busy || !next) return;
  $('error').hidden = true;
  if (!next.size) return showError('This file is empty. Choose an audio file.');
  if (next.size > MAX_BYTES) return showError('Please choose a file smaller than 100 MB.');
  if (!next.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|flac|aac|opus|webm)$/i.test(next.name)) return showError('Choose an audio file, such as an MP3 or WAV.');
  generation++;
  file = next;
  resetResults();
  $('status-area').hidden = true;
  $('dropzone').hidden = true;
  $('selected').hidden = false;
  $('filename').textContent = file.name;
  $('filemeta').textContent = `${(file.size / 1048576).toFixed(1)} MB · Selected on your device`;
  $('original').pause();
  if (originalURL) URL.revokeObjectURL(originalURL);
  originalURL = URL.createObjectURL(file);
  $('original').src = originalURL;
  setBusy(false);
}
$('file').addEventListener('change', event => { selectFile(event.target.files[0]); event.target.value = ''; });
$('replace').addEventListener('click', () => $('file').click());
$('original').addEventListener('loadedmetadata', () => {
  if (!file) return;
  const seconds = $('original').duration;
  $('filemeta').textContent = `${(file.size / 1048576).toFixed(1)} MB · ${Number.isFinite(seconds) ? duration(seconds) : 'Audio'} · Original`;
  if (seconds > MAX_SECONDS) { showError('This track exceeds 10 minutes. Choose a shorter track.'); $('separate').disabled = true; }
});
$('original').addEventListener('error', () => {
  if (file) { showError('Your browser cannot play this file. Try a valid MP3 or WAV.'); $('separate').disabled = true; }
});
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => selectFile(event.dataTransfer.files[0]));
// Prevent a dropped file from navigating away from the app.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
for (const audio of document.querySelectorAll('audio')) audio.addEventListener('play', () => {
  for (const other of document.querySelectorAll('audio')) if (other !== audio) other.pause();
});

$('separate').addEventListener('click', async () => {
  if (!file || busy) return;
  const run = ++generation;
  setBusy(true); resetResults(); $('error').hidden = true;
  $('original').pause();
  status('Reading your audio', null, 'Decoding and resampling locally to 44.1 kHz.');
  try {
    const bytes = await file.arrayBuffer();
    if (run !== generation) return;
    const context = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const audio = await context.decodeAudioData(bytes);
    if (run !== generation) return;
    if (audio.duration > MAX_SECONDS) throw new Error('This track exceeds 10 minutes. Choose a shorter track.');
    if (audio.length < 1) throw new Error('The audio file is empty.');
    if (audio.numberOfChannels > 2) throw new Error('Please choose mono or stereo audio. Surround audio is not supported.');
    const left = new Float32Array(audio.getChannelData(0));
    const right = new Float32Array(audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0));
    $('filemeta').textContent = `${duration(audio.duration)} · ${audio.numberOfChannels === 1 ? 'Mono' : 'Stereo'} · 44.1 kHz processing`;
    worker = new Worker(new URL('./separator.worker.js', import.meta.url), { type: 'module' });
    const fail = message => {
      if (run !== generation) return;
      worker?.terminate(); worker = null; setBusy(false);
      status('Separation stopped', 0, 'Your original file is unchanged.'); showError(message);
    };
    worker.onerror = event => fail(event.message || 'The processing worker stopped. Try a shorter clip or another browser.');
    worker.onmessage = ({ data }) => {
      if (run !== generation) return;
      if (data.type === 'progress') status(data.status, data.progress, data.detail);
      else if (data.type === 'error') fail(data.message);
      else if (data.type === 'done') {
        const stem = file.name.replace(/\.[^.]+$/, '') || 'audio';
        for (const key of ['voice', 'music']) {
          const url = URL.createObjectURL(new Blob([data[key]], { type: 'audio/wav' }));
          resultURLs.push(url); $(`${key}-player`).src = url;
          $(`${key}-download`).href = url; $(`${key}-download`).download = `${stem}-${key === 'voice' ? 'vocals' : 'instrumental'}.wav`;
        }
        $('results').hidden = false;
        $('result-note').textContent = 'Stereo · 44.1 kHz · WAV';
        status('Your tracks are ready', 1, `Separated and encoded in ${duration(data.seconds)}.${data.gain < 1 ? ' Both tracks were lowered equally to prevent clipping.' : ''}`);
        worker.terminate(); worker = null; setBusy(false);
        $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
      }
    };
    worker.postMessage({ left, right, backend: $('backend').value }, [left.buffer, right.buffer]);
  } catch (error) {
    if (run !== generation) return;
    worker?.terminate(); worker = null; setBusy(false);
    status('Unable to process this file', 0);
    showError(error.name === 'EncodingError' ? 'This file could not be decoded. Try another MP3 or WAV.' : error.message);
  }
});
$('cancel').addEventListener('click', () => {
  generation++; worker?.terminate(); worker = null; setBusy(false);
  status('Cancelled', 0, 'Choose Separate to start again. Completed model downloads stay cached.');
});
$('clear-cache').addEventListener('click', async () => {
  $('clear-cache').disabled = true;
  try { await caches.delete(MODEL_CACHE); status('Model cache cleared', 0, 'The model will load again next time you separate a track.'); }
  catch { showError('This browser does not allow access to model storage.'); }
  finally { $('clear-cache').disabled = busy; }
});

async function checkCapabilities() {
  if (!isSecureContext || location.protocol === 'file:') {
    showError('Open this app through localhost or HTTPS. See README.md for the launch command.');
    $('file').disabled = true; $('capability').textContent = 'Local server or HTTPS required'; return;
  }
  let gpu = false;
  try { gpu = !!(await navigator.gpu?.requestAdapter()); } catch { /* Use CPU */ }
  $('capability').textContent = gpu ? '● GPU available' : 'CPU mode available · slower processing';
}
checkCapabilities();
