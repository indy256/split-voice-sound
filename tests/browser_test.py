"""Real Chromium integration test. Run `python serve.py` first.
Test dependency: python -m pip install playwright
"""
import json
import math
import struct
import time
import wave
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'tests' / 'artifacts'
ART.mkdir(exist_ok=True)
fixture = ART / 'tone.wav'
with wave.open(str(fixture), 'wb') as wav:
    wav.setparams((2, 2, 22050, 0, 'NONE', 'not compressed'))
    wav.writeframes(b''.join(struct.pack('<hh', int(8000 * math.sin(2 * math.pi * 440 * i / 22050)), int(4000 * math.sin(2 * math.pi * 330 * i / 22050))) for i in range(22050)))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    page = browser.new_page(viewport={'width': 1365, 'height': 1100}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: print('BROWSER:', m.text[:700], flush=True) if m.type == 'error' else None)
    requests = []
    page.on('request', lambda r: requests.append((r.method, r.url)))
    google_scripts = {
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7159809234886898',
        'https://www.googletagmanager.com/gtag/js?id=G-F2E4TJR9YG',
    }
    for url in google_scripts:
        page.route(url, lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    page.goto('http://localhost:8080')
    page.screenshot(path=str(ART / 'desktop.png'), full_page=True)
    assert page.locator('#separate').is_disabled()
    result = page.evaluate('''async () => {
      const { segmentStarts, blendWeight } = await import('/engine.js');
      const { encodeWav, sharedGain } = await import('/audio.js');
      const N = 343980;
      for (const length of [1, 44100, N, N+1, N*2, N*3+123]) {
        const starts = segmentStarts(length), weights = new Float64Array(length);
        for (let s=0;s<starts.length;s++) {
          const n=Math.min(N,length-starts[s]);
          for(let i=0;i<n;i++) weights[starts[s]+i]+=blendWeight(i,n,s===0,s===starts.length-1);
        }
        if (weights.some(x=>x<=0 || !Number.isFinite(x))) throw Error('Uncovered audio sample');
        if(starts.length > 1 && starts.at(-2)+N>=length) throw Error('Redundant segment');
      }
      const track={left:new Float32Array([-1,0,1]),right:new Float32Array([.5,-.5,0])};
      const view=new DataView(encodeWav(track,44100));
      if(view.byteLength!==56 || view.getUint32(24,true)!==44100 || view.getInt16(44,true)!==-32768 || view.getInt16(52,true)!==32767) throw Error('Incorrect WAV');
      if(sharedGain([{left:new Float32Array([2]),right:new Float32Array([0])}])>=.5) throw Error('Clipping gain');
      return {dsp:'passed', isolated:crossOriginIsolated, gpu:!!navigator.gpu};
    }''')
    print(json.dumps(result), flush=True)
    page.locator('#file').set_input_files({'name':'empty.mp3','mimeType':'audio/mpeg','buffer':b''})
    assert 'empty' in page.locator('#error').inner_text()
    input_file = Path(os.environ.get('TEST_AUDIO', fixture))
    page.locator('#file').set_input_files(str(input_file))
    page.locator('#original').evaluate('(a) => new Promise(r => a.readyState >= 1 ? r() : a.addEventListener("loadedmetadata",r,{once:true}))')
    expected_frames = page.evaluate('''async () => {
      const response = await fetch(document.querySelector('#original').src);
      const audio = await new OfflineAudioContext(2,1,44100).decodeAudioData(await response.arrayBuffer());
      return audio.length;
    }''')
    page.locator('#backend').select_option(os.environ.get('TEST_BACKEND', 'wasm'))
    page.locator('#separate').click()
    page.locator('#cancel').click()
    assert page.locator('#status').inner_text() == 'Cancelled'
    page.locator('#separate').click()
    started = time.time()
    last = ''
    while time.time() - started < 600:
        text = page.locator('#status').inner_text() + ' | ' + page.locator('#detail').inner_text()
        if text != last: print(text, flush=True); last = text
        if page.locator('#error').is_visible(): raise AssertionError(page.locator('#error').inner_text())
        if page.locator('#results').is_visible(): break
        page.wait_for_timeout(1000)
    else: raise AssertionError('Inference did not finish in ten minutes')
    for key in ['voice','music']:
        with page.expect_download() as info: page.locator(f'#{key}-download').click()
        target = ART / info.value.suggested_filename
        info.value.save_as(target)
        with wave.open(str(target), 'rb') as wav:
            assert wav.getnchannels()==2 and wav.getframerate()==44100 and wav.getnframes()==expected_frames
            values=struct.unpack('<'+'h'*(expected_frames*2),wav.readframes(expected_frames))
            print(key, 'peak', max(abs(v) for v in values), flush=True)
            assert max(abs(v) for v in values)>0
    assert not errors, errors
    assert all(method == 'GET' for method, url in requests), requests
    assert all(url in google_scripts or url.startswith(('http://localhost:8080','blob:','data:')) for _,url in requests), requests
    page.screenshot(path=str(ART / 'results.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(ART / 'mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # A second run must read the persisted model without another model request.
    before = len([url for _,url in requests if url.endswith('.onnx')])
    page.locator('#separate').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('cached') || document.querySelector('#status').textContent.includes('Preparing') || document.querySelector('#status').textContent.includes('Separating')")
    page.locator('#cancel').click()
    assert len([url for _,url in requests if url.endswith('.onnx')]) == before
    page.locator('#clear-cache').click()
    page.wait_for_function("document.querySelector('#status').textContent === 'Model cache cleared'")
    assert page.evaluate("caches.keys()") == []
    print('PASS: real inference, WAV downloads, cancellation/retry, caching/clear, local-only requests, DSP, desktop and mobile.', flush=True)
    browser.close()
