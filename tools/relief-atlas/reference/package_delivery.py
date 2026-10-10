import json
import zipfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    destination = root / 'relief-atlas-delivery.zip'
    directories = ['data', 'outputs', 'renders', 'scenes', 'logs']
    source_files = sorted(path for path in root.iterdir() if path.suffix in {'.py', '.md', '.json', '.html', '.slurm'})
    for directory in directories:
        source_files.extend(sorted((root / directory).glob('*')))
    source_files.extend(sorted(path for path in (root / 'cache').glob('*') if path.is_file()))
    source_files.extend(sorted(path for path in (root / 'lighting_review').glob('*') if path.suffix in {'.png', '.jpg', '.json'}))
    excluded_names = {'china_review.jpg', 'hainan_preview.png'}
    source_files = [path for path in source_files if path.is_file() and path.name not in excluded_names]
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        for path in source_files:
            archive.write(path, Path(root.name) / path.relative_to(root))
    with zipfile.ZipFile(destination) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError('Corrupt archive member: ' + corrupt)
        count = len(archive.namelist())
    print(json.dumps({'archive': str(destination), 'bytes': destination.stat().st_size, 'files': count, 'crc_check': 'passed'}, indent=2))


if __name__ == '__main__':
    main()
