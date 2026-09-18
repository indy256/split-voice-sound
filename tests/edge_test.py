"""Error handling and actual single-thread inference; requires the local server."""
import math
import struct
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright

ART = Path(__file__).resolve().parent / 'artifacts'
ART.mkdir(exist_ok=True)
fixture = ART / 'mono48.wav'
with wave.open(str(fixture), 'wb') as wav:
    wav.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
    wav.writeframes(b''.join(struct.pack('<h', int(5000 * math.sin(2 * math.pi * 220 * i / 48000))) for i in range(12000)))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:8080')
    page.locator('#file').set_input_files({'name':'broken.mp3','mimeType':'audio/mpeg','buffer':b'not a real mp3'})
    page.wait_for_function("!document.querySelector('#error').hidden")
    assert page.locator('#separate').is_disabled()
    page.locator('#file').set_input_files(str(fixture))
    page.wait_for_function("document.querySelector('#original').readyState >= 1")
    page.route('**/models/htdemucs.onnx', lambda r: r.fulfill(status=503, body='Unavailable'))
    page.locator('#separate').click()
    page.wait_for_function("!document.querySelector('#error').hidden")
    assert '503' in page.locator('#error').inner_text()
    assert page.locator('#separate').is_enabled()
    page.unroute('**/models/htdemucs.onnx')
    page.route('**/models/htdemucs.onnx', lambda r: r.fulfill(status=200, content_type='application/octet-stream', body='truncated'))
    page.locator('#separate').click()
    page.wait_for_function("!document.querySelector('#error').hidden")
    assert 'incomplete' in page.locator('#error').inner_text()
    assert page.evaluate('async () => (await (await caches.open("split-model-92e33df6-v1")).keys()).length') == 0
    page.close()

    # A generic static host without COOP/COEP must use single-threaded WASM.
    context = browser.new_context()
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    def ordinary_host(route):
        response = route.fetch()
        headers = {key:value for key,value in response.headers.items() if not key.startswith('cross-origin-')}
        route.fulfill(response=response, headers=headers)
    page.route('http://localhost:8080/', ordinary_host)
    page.goto('http://localhost:8080')
    assert not page.evaluate('crossOriginIsolated')
    page.locator('#file').set_input_files(str(fixture))
    page.locator('#backend').select_option('wasm')
    page.wait_for_function("document.querySelector('#original').readyState >= 1")
    expected_frames = page.evaluate('''async () => {
      const bytes = await (await fetch(document.querySelector('#original').src)).arrayBuffer();
      return (await new OfflineAudioContext(2,1,44100).decodeAudioData(bytes)).length;
    }''')
    page.locator('#separate').click()
    page.wait_for_function("!document.querySelector('#results').hidden || !document.querySelector('#error').hidden", timeout=180000)
    assert page.locator('#error').is_hidden(), page.locator('#error').inner_text()
    for key in ['voice','music']:
        result = page.evaluate('''async key => {
          const bytes = await (await fetch(document.querySelector(`#${key}-download`).href)).arrayBuffer();
          const v = new DataView(bytes);
          let maxDiff=0;
          for(let i=44;i<bytes.byteLength;i+=4) maxDiff=Math.max(maxDiff,Math.abs(v.getInt16(i,true)-v.getInt16(i+2,true)));
          return {frames:(bytes.byteLength-44)/4,rate:v.getUint32(24,true),maxDiff};
        }''', key)
        assert abs(expected_frames-11025)<=1
        assert result['frames']==expected_frames and result['rate']==44100, result
        # Stereo model can introduce small channel differences for mono input.
        assert result['maxDiff'] < 1000, result
    assert not errors, errors
    print('PASS: corrupt audio, failed/truncated downloads, recovery, uncached failures, mono 48kHz resampling, real single-threaded inference.', flush=True)
    browser.close()
