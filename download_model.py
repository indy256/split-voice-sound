"""Download the pinned model for fully local hosting (Python standard library only)."""
import hashlib
from pathlib import Path
import urllib.request

URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx'
SHA256 = 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077'

def main():
    target = Path(__file__).resolve().parent / 'models' / 'htdemucs.onnx'
    target.parent.mkdir(exist_ok=True)
    if target.exists():
        with target.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() == SHA256:
                print('The pinned model is already present and verified.')
                return
    temporary = target.with_suffix('.download')
    print('Downloading 180.5 MB model…', flush=True)
    try:
        urllib.request.urlretrieve(URL, temporary)
        with temporary.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != SHA256:
                raise RuntimeError('Model checksum mismatch. Please retry the download.')
        temporary.replace(target)
        print(f'Verified model saved to {target}')
    finally:
        temporary.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
