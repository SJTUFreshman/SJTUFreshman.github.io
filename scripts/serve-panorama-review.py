"""Preview an isolated panorama catalog on localhost without changing the site."""
import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit


SITE_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_MANIFEST = SITE_ROOT / 'assets/life/panoramas/manifest.json'


def contained_path(path):
    resolved = path.resolve()
    if not resolved.is_relative_to(SITE_ROOT):
        raise ValueError('Paths must remain inside the repository')
    return resolved


def load_catalog(value):
    supplied = Path(value)
    if '..' in supplied.parts:
        raise ValueError('--manifest must not contain directory traversal')
    path = contained_path(supplied if supplied.is_absolute() else SITE_ROOT / supplied)
    if path == PRODUCTION_MANIFEST.resolve() or (
        path.exists() and PRODUCTION_MANIFEST.exists() and path.samefile(PRODUCTION_MANIFEST)
    ):
        raise ValueError('--manifest must be an isolated review catalog, not the production manifest')
    if not path.is_file():
        raise ValueError('--manifest must point to an existing JSON file')
    payload = path.read_bytes()
    catalog = json.loads(payload)
    if not isinstance(catalog, dict) or catalog.get('version') != 1 or catalog.get('projection') != 'equirectangular':
        raise ValueError('Expected a version 1 equirectangular panorama catalog')
    scenes = catalog.get('scenes')
    if not isinstance(scenes, dict) or not scenes:
        raise ValueError('The review catalog must contain scenes')
    scope = []
    for scene, entry in scenes.items():
        if not isinstance(entry, dict) or not isinstance(entry.get('variants', {}), dict):
            raise ValueError(f'Invalid scene entry: {scene}')
        variants = entry.get('variants', {})
        scope.append(f"{scene}: {', '.join(variants) or '(no rendered variants)'}")
    return path, payload, scope


def request_path(raw):
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        raise ValueError('Only repository-relative request paths are supported')
    decoded = unquote(parsed.path, errors='strict')
    if not decoded.startswith('/') or any(char in decoded for char in ('\\', ':', '\0')):
        raise ValueError('Invalid request path')
    parts = decoded.split('/')
    if '..' in parts:
        raise ValueError('Directory traversal is not allowed')
    return contained_path(SITE_ROOT.joinpath(*parts[1:]))


def make_handler(payload):
    class ReviewHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(SITE_ROOT), **kwargs)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()

        def translate_path(self, path):
            return str(request_path(path))

        def send_head(self):
            try:
                target = request_path(self.path)
                if target.is_dir():
                    # SimpleHTTPRequestHandler selects these index files internally.
                    # Check them too so an index symlink cannot escape the repository.
                    for name in ('index.html', 'index.htm'):
                        index = target / name
                        if index.exists():
                            contained_path(index)
                            break
            except (ValueError, OSError) as failure:
                self.send_error(403, str(failure))
                return None
            if target == PRODUCTION_MANIFEST.resolve():
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('X-Panorama-Preview', 'isolated-review')
                self.end_headers()
                return BytesIO(payload)
            # Always return fresh bytes, even if an earlier local server cached this URL.
            if 'If-Modified-Since' in self.headers:
                del self.headers['If-Modified-Since']
            return super().send_head()

    return ReviewHandler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, help='Review JSON inside the repository; relative paths use its root')
    parser.add_argument('--port', type=int, default=8766, help='Local port (default: 8766; 0 selects an available port)')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    try:
        manifest, payload, scope = load_catalog(args.manifest)
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(payload))
    except (ValueError, OSError) as failure:
        parser.error(str(failure))
    with server:
        print('ISOLATED PANORAMA REVIEW - production files are unchanged', flush=True)
        print(f'Life page: http://127.0.0.1:{server.server_port}/life.html', flush=True)
        print(f'Repository: {SITE_ROOT}', flush=True)
        print(f'Catalog snapshot: {manifest.relative_to(SITE_ROOT).as_posix()}', flush=True)
        print(f'SHA-256: {hashlib.sha256(payload).hexdigest()}', flush=True)
        print('Catalog scope: ' + '; '.join(scope), flush=True)
        print('Only the panorama manifest response is replaced; other files come from the repository.', flush=True)
        print('Review only: this does not install assets or grant visual approval. Restart to reload the catalog.', flush=True)
        print('All responses use no-store. Press Ctrl+C to stop.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nReview server stopped.', flush=True)


if __name__ == '__main__':
    main()
