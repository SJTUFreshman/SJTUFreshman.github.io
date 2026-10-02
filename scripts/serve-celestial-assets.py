import argparse
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class AssetHandler(SimpleHTTPRequestHandler):
    server_version = 'LifeCelestialAssets/1.0'

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, format_string, *args):
        if os.environ.get('CELESTIAL_ACCESS_LOG') == '1':
            super().log_message(format_string, *args)


def main():
    parser = argparse.ArgumentParser(description='Serve one immutable celestial atlas release.')
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f'Asset root is not a directory: {root}')
    handler = partial(AssetHandler, directory=str(root))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
