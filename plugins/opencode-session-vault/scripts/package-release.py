"""Crea el ZIP distribuible sin dependencias de desarrollo ni datos de usuario."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
folders = {'src', 'test', 'scripts', 'docs', 'assets', 'dist'}
files = []
for file in root.rglob('*'):
    relative = file.relative_to(root)
    if not file.is_file() or 'node_modules' in relative.parts or '__pycache__' in relative.parts:
        continue
    if len(relative.parts) > 1 and relative.parts[0] not in folders:
        continue
    if relative.as_posix() in {'SHA256SUMS.txt', 'scripts/ui-smoke.mjs'} or file.suffix in {'.tmp', '.log', '.zip', '.pyc'}:
        continue
    files.append(file)
files.sort()
manifest = root / 'SHA256SUMS.txt'
manifest.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(root).as_posix()}\n' for file in files))
files.append(manifest)
output = root.parent / f'opencode-session-vault-v{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        archive.write(file, f'opencode-session-vault/{file.relative_to(root).as_posix()}')
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    for required in ('dist/tui.js', 'dist/install.mjs', 'INSTALAR.cmd', 'README.md', 'docs/02-PRD.md', 'docs/03-ARD.md'):
        assert f'opencode-session-vault/{required}' in names
    for line in manifest.read_text().splitlines():
        sha, name = line.split('  ', 1)
        assert hashlib.sha256(archive.read(f'opencode-session-vault/{name}')).hexdigest() == sha
print(json.dumps({'file': str(output), 'files': len(files), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
