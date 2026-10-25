"""Linux PTY smoke test: starts an ephemeral Pi; never submits an LLM prompt."""
import os
import pty
import fcntl
import termios
import struct
import subprocess
import select
import time
import tempfile
import shutil
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

extension = Path(os.environ.get('PI_EXTENSION', str(Path(__file__).resolve().parents[1] / 'index.ts')))
pi = os.environ.get('PI_BIN') or shutil.which('pi') or str(Path.home() / '.pi/agent/bin/pi')
with tempfile.TemporaryDirectory(prefix='pi-workspace-pty-') as root:
    Path(root, 'a.ts').write_text('export const a = 1;\n')
    # Load an existing user message: an empty chat misses background-render crashes.
    stamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    session = Path(root, '.background-regression.jsonl')
    session.write_text('\n'.join(json.dumps(entry) for entry in [
        {'type': 'session', 'version': 3, 'id': str(uuid.uuid4()), 'timestamp': stamp, 'cwd': root},
        {'type': 'message', 'id': '1234abcd', 'parentId': None, 'timestamp': stamp,
         'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Background regression fixture'}], 'timestamp': int(time.time() * 1000)}},
    ]) + '\n')
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
    process = subprocess.Popen(
        [pi, '--session', str(session), '--no-extensions', '--no-tools', '--tui-mode', 'fullscreen', '-e', str(extension)],
        stdin=slave, stdout=slave, stderr=slave, cwd=root,
        env=dict(os.environ, TERM='xterm-256color'), start_new_session=True,
    )
    os.close(slave)
    output = bytearray()

    def drain(seconds):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if select.select([master], [], [], .1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                output.extend(chunk)
                if b'\x1b[6n' in chunk:
                    os.write(master, b'\x1b[1;1R')

    def key(data, delay=.4):
        os.write(master, data)
        drain(delay)

    try:
        drain(4)
        assert process.poll() is None, output.decode('utf8', 'replace')[-6000:]
        for binding in [b'\x1bn', b'\x1bs', b'\x1ba']:
            key(binding)
            key(binding)
        # Kitty press + auto-repeat + release must leave the browser focused.
        key(b'\x1b[110;3u')
        key(b'\x1b[110;3:2u')
        key(b'\x1b[110;3:3u')
        key(b'r')
        key(b'\x15b.ts\r', .7)
        assert Path(root, 'b.ts').is_file(), list(Path(root).iterdir())
        assert not Path(root, 'a.ts').exists()
        key(b'\x1b[3~')
        key(b'\x1b', .7)
        assert Path(root, 'b.ts').is_file(), 'Cancel must preserve file'
        key(b' ')
        key(b'\x1b')
        key(b'\x1bn')
        key(b'/workspace-off\r', .8)
        key(b'\x03')
        key(b'\x03', .8)
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=3)
        text = output.decode('utf8', 'replace')
        for title in ['ARQUIVOS', 'PROJETO', 'SESSÕES', 'SUBAGENTES', 'PRÉVIA']:
            assert title in text, title
        for error in ['TypeError', 'ReferenceError', 'incompatível', 'Extension Error', 'Unknown theme color', 'uncaughtException']:
            assert error not in text, text[max(0, text.find(error) - 200):text.find(error) + 2500]
        assert process.returncode == 0, process.returncode
        print('PASS: real Pi PTY, focus toggles, prefilled rename, cancelled deletion, preview, workspace-off and clean exit; no model request.')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
