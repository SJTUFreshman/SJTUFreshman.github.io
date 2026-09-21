"""Fetch the official NASA ISS interior archive into isolated review storage."""
import argparse
import hashlib
import html
import json
import re
import shutil
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path


MODEL_PAGE = 'https://science.nasa.gov/3d-resources/international-space-station-iss-e-internal/'
LICENSE_PAGE = 'https://www.nasa.gov/nasa-brand-center/images-and-media/'
TREE_URL = 'https://api.github.com/repos/nasa/NASA-3D-Resources/git/trees/master?recursive=1'
MODEL_NAME = 'International Space Station (ISS) (E) (Internal)'


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Life-offline-asset-review'}), timeout=90)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent.parent / '.render-work/public-models/nasa')
    arguments = parser.parse_args()
    destination = arguments.output.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    snapshots = {}
    for label, url in (('source', MODEL_PAGE), ('license', LICENSE_PAGE)):
        with request(url) as response:
            content = response.read()
        (destination / (label + '.html')).write_bytes(content)
        snapshots[label] = {'url': url, 'sha256': hashlib.sha256(content).hexdigest()}
    source = (destination / 'source.html').read_text(encoding='utf-8')
    urls = sorted(set(html.unescape(url) for url in re.findall(r'href=["\']([^"\']+\.7z\.\d{3})["\']', source)))
    if len(urls) != 8 or any(not url.startswith('https://assets.science.nasa.gov/') for url in urls):
        raise ValueError('NASA page does not expose the eight expected official archive volumes')
    with request(TREE_URL) as response:
        tree = json.load(response)
    records = {entry['path'].rsplit('/', 1)[-1]: entry for entry in tree['tree']
               if entry['path'].startswith('3D Models/' + MODEL_NAME + '/')}

    def download(page_url):
        name = urllib.parse.unquote(page_url.rsplit('/', 1)[-1])
        expected = records[name]
        url = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/' + tree['sha'] + '/' + urllib.parse.quote(expected['path'])
        path = destination / name
        if not path.is_file() or path.stat().st_size != expected['size']:
            temporary = path.with_suffix(path.suffix + '.partial')
            with request(url) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            if temporary.stat().st_size != expected['size']:
                raise ValueError('Unexpected NASA archive size: ' + name)
            temporary.replace(path)
        sha256 = hashlib.sha256()
        git_blob = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
        with path.open('rb') as source_file:
            for block in iter(lambda: source_file.read(1024 * 1024), b''):
                sha256.update(block)
                git_blob.update(block)
        if git_blob.hexdigest() != expected['sha']:
            raise ValueError('NASA assets file differs from the official NASA GitHub blob: ' + name)
        report = {'name': name, 'url': url, 'official_page_download_url': page_url,
                  'bytes': path.stat().st_size, 'sha256': sha256.hexdigest(),
                  'official_github_blob_sha1': git_blob.hexdigest()}
        print(json.dumps(report), flush=True)
        return report

    with ThreadPoolExecutor(max_workers=4) as executor:
        volumes = list(executor.map(download, urls))
    archive = destination / (MODEL_NAME + '.7z')
    with archive.open('wb') as output:
        for volume in volumes:
            with (destination / volume['name']).open('rb') as source_file:
                shutil.copyfileobj(source_file, output, 1024 * 1024)
    sha256 = hashlib.sha256()
    with archive.open('rb') as source_file:
        for block in iter(lambda: source_file.read(1024 * 1024), b''):
            sha256.update(block)
    report = {'asset': MODEL_NAME, 'retrieved_at_utc': datetime.now(timezone.utc).isoformat(),
              'snapshots': snapshots, 'official_github_tree_url': TREE_URL, 'official_github_tree_sha': tree['sha'],
              'volumes': volumes, 'archive': {'name': archive.name, 'bytes': archive.stat().st_size,
                                           'sha256': sha256.hexdigest()},
              'license_summary': 'NASA media guidelines explicitly include 3D textures and polygon files; personal webpages allowed, acknowledge NASA, do not imply endorsement; third-party exceptions must be checked.',
              'installed_in_runtime': False, 'visual_approval': False}
    (destination / 'provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('NASA_ARCHIVE_VERIFIED', json.dumps(report['archive']), flush=True)


if __name__ == '__main__':
    main()
