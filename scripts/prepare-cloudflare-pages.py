import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOTS = {'assets', 'documents', 'fonts', 'images'}
ROOT_FILES = {'index.html', 'life.html', 'pet-cache-worker.js', 'me_at_dorm.jpg', 'official_portray.png'}
STATIC_SUFFIXES = {'.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
                   '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.md', '.txt'}
MAX_FILES = 20000
MAX_BYTES = 25 * 1024 * 1024


def source_file(root, relative):
    relative_path = PurePosixPath(relative)
    if (not relative or relative_path.is_absolute() or '\\' in relative or ':' in relative or
            any(part in ('.', '..') for part in relative.split('/'))):
        raise ValueError(f'Unsafe source path: {relative}')
    source = root.joinpath(*relative_path.parts)
    if source.resolve() != source or not source.is_file():
        raise ValueError(f'Source must be a regular file without symlinks: {relative}')
    if source.stat().st_size > MAX_BYTES:
        raise ValueError(f'File exceeds the Pages 25 MiB limit: {relative}')
    return source


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def public_files(root):
    tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True, capture_output=True)
    paths = tracked.stdout.decode('utf-8').split('\0')
    entries = {}
    for relative in paths:
        parts = PurePosixPath(relative).parts
        if not parts or (relative not in ROOT_FILES and parts[0] not in PUBLIC_ROOTS):
            continue
        if (any(part.startswith('.') or part in {'__pycache__', 'render-metadata'} for part in parts) or
                PurePosixPath(relative).suffix.lower() not in STATIC_SUFFIXES or
                relative.startswith('assets/celestial/') or
                parts[-1] == 'package.json'):
            continue
        entries[relative] = {'source': source_file(root, relative)}
    if not ROOT_FILES.issubset(entries):
        raise ValueError('Tracked website entry points are missing.')
    return entries


def validate_output(root, output):
    output = output if output.is_absolute() else root / output
    absolute = output.absolute()
    resolved = output.resolve()
    work = root / '.render-work'
    if (resolved != absolute or not resolved.is_relative_to(work) or resolved == work or
            resolved.exists() and (not resolved.is_dir() or any(resolved.iterdir()))):
        raise ValueError('Output must be a new or empty directory inside this workspace .render-work, without symlinks.')
    report = resolved.with_name(resolved.name + '-report.json')
    if report.exists() or report.is_symlink():
        raise ValueError(f'Report already exists; choose a new output directory: {report}')
    return resolved, report


def copy_entry(entry, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    source = entry.get('source')
    if source:
        if source.resolve() != source:
            raise ValueError(f'Source became a symlink: {source}')
        with source.open('rb') as incoming, destination.open('xb') as outgoing:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError(f'File exceeds 25 MiB: {source}')
                digest.update(chunk)
                outgoing.write(chunk)
    else:
        data = entry['data']
        with destination.open('xb') as outgoing:
            outgoing.write(data)
        size = len(data)
        digest.update(data)
    checksum = digest.hexdigest()
    if size != entry['bytes'] or entry.get('sha256', checksum) != checksum:
        raise ValueError(f'Size or SHA256 mismatch after copy: {source or destination}')
    return {'bytes': size, 'sha256': checksum}


def prepare(root, output):
    root = root.resolve()
    output, report_path = validate_output(root, output)
    entries = public_files(root)
    entries['404.html'] = {'data': (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title>'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<h1>Page not found</h1><p><a href="/">Return home</a></p></html>\n').encode('utf-8')}
    entries['_headers'] = {'data': (
        '/pet-cache-worker.js\n  Cache-Control: no-cache\n').encode('utf-8')}
    for relative, entry in entries.items():
        entry['bytes'] = entry['source'].stat().st_size if 'source' in entry else len(entry['data'])
        if entry['bytes'] > MAX_BYTES:
            raise ValueError(f'File exceeds the Pages 25 MiB limit: {relative}')
    if len(entries) > MAX_FILES:
        raise ValueError(f'Pages file limit exceeded: {len(entries)} > {MAX_FILES}')
    output.mkdir(parents=True, exist_ok=True)
    records = {}
    for index, (relative, entry) in enumerate(sorted(entries.items()), 1):
        records[relative] = copy_entry(entry, output / relative)
        if index % 1000 == 0:
            print(f'Copied and verified {index}/{len(entries)} files.', flush=True)
    report = {
        'preparedAt': datetime.now(timezone.utc).isoformat(), 'output': str(output),
        'fileCount': len(records), 'totalBytes': sum(record['bytes'] for record in records.values()),
        'limits': {'files': MAX_FILES, 'fileBytes': MAX_BYTES},
        'files': records,
    }
    with report_path.open('xb') as destination:
        destination.write(json_bytes(report))
    print(f'Prepared {len(records)} public files in {output}\nPrivate verification report: {report_path}')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Prepare a verified static Cloudflare Pages upload directory.')
    parser.add_argument('--output', type=Path, default=Path('.render-work/cloudflare-pages/site'))
    args = parser.parse_args(argv)
    try:
        prepare(ROOT, args.output)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Preparation failed: {error}\nDo not deploy a partially prepared directory. Use a new empty output for retry.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
