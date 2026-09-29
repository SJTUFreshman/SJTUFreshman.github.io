"""Inventory supplied Unreal archives without modifying or executing their content."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import subprocess
import sys

import rarfile


ARCHIVES = (
    ('snowmountain', 'Snowy Mountains Landscape/Snowy Mountains Landscape.rar'),
    ('shelter', '废墟城市建模/ProjectsCity.rar'),
    ('fontainesaintmichel', 'FontaineSaintMichel.rar'),
)
MAX_METADATA_BYTES = 2 * 1024 * 1024


def sha256_file(source):
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def extract_member(extractor, archive, member, password=None):
    name = Path(extractor).stem.lower()
    if name in ('7z', '7za', '7zz'):
        command = [extractor, 'x', '-so', '-y']
        if password:
            command.append('-p' + password)
        command.extend([str(archive), member])
    elif name in ('unrar', 'rar'):
        command = [extractor, 'p', '-inul', '-p' + password if password else '-p-', str(archive), member]
    else:
        command = [extractor]
        if password:
            command.extend(['--passphrase', password])
        command.extend(['-xOf', str(archive), member])
    result = subprocess.run(command, capture_output=True, timeout=180, check=False)
    if result.returncode:
        detail = result.stderr.decode('utf-8', errors='replace').strip()
        raise ValueError(f'Extractor exited {result.returncode}: {detail[:1500]}')
    return result.stdout


def package_versions(header):
    if header[:4] != b'\xc1\x83\x2a\x9e':
        raise ValueError('Selected asset does not have the Unreal package signature')
    records = []
    for match in re.finditer(rb'\+\+UE[^\x00\r\n]{1,100}', header):
        offset = match.start()
        if offset < 14:
            continue
        major, minor, patch, changelist, length = struct.unpack_from('<HHHIi', header, offset - 14)
        if major not in (4, 5) or minor > 99 or patch > 99 or length != len(match.group()) + 1:
            continue
        records.append({'offset': offset - 14, 'version': f'{major}.{minor}.{patch}',
                        'changelist': changelist, 'branch': match.group().decode('ascii')})
    return records


def map_references(text):
    references = []
    section = ''
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
        elif '=' in line and not line.startswith((';', '#')):
            key, value = line.split('=', 1)
            if section == '/Script/EngineSettings.GameMapsSettings' and key.strip() in (
                    'EditorStartupMap', 'GameDefaultMap', 'ServerDefaultMap', 'TransitionMap'):
                references.append({'setting': key.strip(), 'reference': value.strip()})
    return references


def metadata_record(source, item, extractor, password, evidence):
    if item.file_size > MAX_METADATA_BYTES:
        raise ValueError(f'Metadata exceeds {MAX_METADATA_BYTES} byte read limit')
    data = extract_member(extractor, source, item.filename, password)
    if len(data) != item.file_size:
        raise ValueError(f'Extracted size {len(data)} differs from indexed size {item.file_size}')
    text = data.decode('utf-8-sig')
    target = evidence / PurePosixPath(item.filename).name
    record = {'archive_path': item.filename, 'bytes': len(data),
              'sha256': hashlib.sha256(data).hexdigest(), 'evidence_file': str(target.resolve())}
    if item.filename.lower().endswith('.uproject'):
        record['project'] = json.loads(text)
    else:
        record['map_references'] = map_references(text)
    evidence.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return record


def inspect_archive(identifier, source, extractor, password, evidence_root):
    record = {'scene_id': identifier, 'archive': str(source.resolve()), 'errors': []}
    if not source.is_file():
        record['errors'].append('Source archive is missing')
        return record
    before = source.stat()
    record['archive_bytes'] = before.st_size
    record['archive_mtime_ns'] = before.st_mtime_ns
    print(f'{identifier}: hashing {before.st_size} bytes', flush=True)
    record['archive_sha256'] = sha256_file(source)
    print(f'{identifier}: indexing archive and reading metadata', flush=True)
    with rarfile.RarFile(source) as archive:
        if password:
            archive.setpassword(password)
        entries = archive.infolist()
        files = [entry for entry in entries if not entry.isdir()]
        record.update({'entry_count': len(entries), 'file_count': len(files),
                       'directory_count': len(entries) - len(files),
                       'uncompressed_bytes': sum(entry.file_size for entry in files),
                       'encrypted_file_count': sum(entry.needs_password() for entry in files),
                       'extensions': dict(sorted(Counter(PurePosixPath(entry.filename).suffix.lower()
                                                        or '(none)' for entry in files).items()))})
        projects = [entry for entry in files if entry.filename.lower().endswith('.uproject')]
        configs = [entry for entry in files if PurePosixPath(entry.filename).name.lower() == 'defaultengine.ini']
        maps = [entry for entry in files if entry.filename.lower().endswith('.umap')]
        record['project_paths'] = [entry.filename for entry in projects]
        record['default_engine_paths'] = [entry.filename for entry in configs]
        record['maps'] = [{'path': entry.filename, 'bytes': entry.file_size} for entry in maps]
        record['main_map_candidates'] = [entry.filename for entry in maps
                                         if any(part in entry.filename.lower() for part in ('/maps/', '/levels/'))
                                         and not any(part in entry.filename.lower() for part in
                                                     ('/sublevels/', '/misc/', '/saved/', '/packedactors/'))]
        record['main_map_candidates_basis'] = 'Archive paths only; startup map settings below take precedence'
        record['metadata'] = []
        for entry in projects + configs:
            try:
                record['metadata'].append(metadata_record(source, entry, extractor, password,
                                                           evidence_root / identifier))
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                record['errors'].append({'archive_path': entry.filename, 'error': str(error)})
        assets = sorted((entry for entry in files if entry.filename.lower().endswith('.uasset')
                         and 512 <= entry.file_size <= 65536), key=lambda entry: (entry.file_size, entry.filename))
        record['asset_header_checks'] = []
        for entry in assets[:3]:
            check = {'archive_path': entry.filename, 'bytes': entry.file_size}
            try:
                data = extract_member(extractor, source, entry.filename, password)
                if len(data) != entry.file_size:
                    raise ValueError('Extracted asset size differs from the archive index')
                header = data[:4096]
                check.update({'asset_sha256': hashlib.sha256(data).hexdigest(),
                              'header_bytes_examined': len(header),
                              'engine_version_records': package_versions(header),
                              'interpretation': 'Embedded package engine-version records; not proof of project compatibility'})
                record['asset_header_checks'].append(check)
                if check['engine_version_records']:
                    break
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                check['error'] = str(error)
                record['asset_header_checks'].append(check)
                record['errors'].append({'archive_path': entry.filename, 'error': str(error)})
                break
    after = source.stat()
    record['source_stat_unchanged'] = before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns
    if not record['source_stat_unchanged']:
        record['errors'].append('Source changed while it was being inspected; checksum is not a stable transfer reference')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets-root', type=Path, default=Path.home() / 'Desktop' / '建模素材')
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).resolve().parents[1] / '.render-work/authored-worlds-20260927/source-inventory.json')
    parser.add_argument('--extractor', default=shutil.which('tar') or 'tar',
                        help='Path to bsdtar/tar, 7z/7za/7zz, or unrar; content is read to stdout only')
    parser.add_argument('--snow-password', default='cgtall.com')
    arguments = parser.parse_args()
    output = arguments.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {'schema_version': 1, 'created_at_utc': datetime.now(timezone.utc).isoformat(),
              'assets_root': str(arguments.assets_root.resolve()), 'extractor': arguments.extractor,
              'scope': 'Read-only source inventory; no source execution, rendering, visual approval, or runtime installation',
              'archives': []}
    for identifier, relative in ARCHIVES:
        try:
            record = inspect_archive(identifier, arguments.assets_root / relative, arguments.extractor,
                                     arguments.snow_password if identifier == 'snowmountain' else None,
                                     output.parent / 'metadata')
        except (OSError, ValueError, rarfile.Error) as error:
            record = {'scene_id': identifier, 'archive': str((arguments.assets_root / relative).resolve()),
                      'errors': [str(error)]}
        report['archives'].append(record)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f"{identifier}: {record.get('file_count', 0)} files; {len(record['errors'])} recorded errors", flush=True)
    print(f'Inventory: {output}', flush=True)
    return 1 if any(record['errors'] for record in report['archives']) else 0


if __name__ == '__main__':
    sys.exit(main())
