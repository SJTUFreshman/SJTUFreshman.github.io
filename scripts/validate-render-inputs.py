#!/usr/bin/env python3
"""Check queued render inputs using file I/O only, without Blender or a GPU."""
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit


INVALID_JSON = object()


class InputValidation:
    def __init__(self, asset_root, workdir=None):
        self.workdir = Path(workdir or Path.cwd()).resolve()
        self.asset_root = self.resolve(asset_root, self.workdir)
        self.errors = []
        self.files = set()
        self.gltfs = set()
        self.entries = 0

    @staticmethod
    def resolve(value, base):
        return (base / value).resolve()

    def error(self, context, message):
        self.errors.append(f'{context}: {message}')

    def file(self, value, base, context):
        if not isinstance(value, str) or not value.strip():
            self.error(context, 'expected a nonempty local file path')
            return None
        if '://' in value or value.startswith('//'):
            self.error(context, f'remote file paths are not allowed: {value}')
            return None
        try:
            source = self.resolve(value, base)
            if not source.is_file():
                self.error(context, f'missing file: {source}')
                return None
        except (OSError, ValueError) as error:
            self.error(context, f'invalid file path {value!r}: {error}')
            return None
        self.files.add(source)
        return source

    def json(self, source, context):
        if source is None:
            return INVALID_JSON
        try:
            return json.loads(source.read_text(encoding='utf-8-sig'))
        except (OSError, UnicodeError, ValueError) as error:
            self.error(context, f'invalid JSON in {source}: {error}')
            return INVALID_JSON

    def gltf(self, source, context):
        if source is None or source in self.gltfs:
            return
        self.gltfs.add(source)
        description = self.json(source, context)
        if description is INVALID_JSON:
            return
        if not isinstance(description, dict):
            self.error(context, 'glTF JSON must be an object')
            return
        for collection in ('buffers', 'images'):
            references = description.get(collection, [])
            if not isinstance(references, list):
                self.error(context, f'glTF {collection} must be a list')
                continue
            for index, reference in enumerate(references):
                label = f'{context} {collection}[{index}]'
                if not isinstance(reference, dict):
                    self.error(label, 'expected an object')
                    continue
                if 'uri' not in reference:
                    if collection == 'buffers' or 'bufferView' not in reference:
                        self.error(label, 'missing external URI or embedded image bufferView')
                    continue
                uri = reference['uri']
                if not isinstance(uri, str) or not uri.strip():
                    self.error(label, 'URI must be a nonempty string')
                    continue
                try:
                    parsed = urlsplit(uri)
                except ValueError as error:
                    self.error(label, f'invalid URI: {error}')
                    continue
                if parsed.scheme.lower() == 'data':
                    continue
                if parsed.scheme or parsed.netloc or uri.startswith(('//', '\\\\')):
                    self.error(label, f'remote or non-relative URI is not allowed: {uri}')
                    continue
                if parsed.query or parsed.fragment:
                    self.error(label, f'local URI cannot contain a query or fragment: {uri}')
                    continue
                self.file(unquote(parsed.path), source.parent, label)

    def materials(self, values, root, context):
        if not isinstance(values, list):
            self.error(context, 'scene materials must be a list')
            return
        for index, material in enumerate(values):
            label = f'{context} materials[{index}]'
            if not isinstance(material, dict):
                self.error(label, 'expected an object')
                continue
            textures = material.get('textures', {})
            if not isinstance(textures, dict):
                self.error(label, 'textures must be an object')
                continue
            textures = dict(textures)
            offline = material.get('offlineMaterial')
            if offline:
                if not isinstance(offline, str):
                    self.error(label, 'offlineMaterial must be a string')
                    continue
                for channel, suffix in (('baseColor', 'diff'), ('normal', 'nor'), ('roughness', 'rough')):
                    candidates = [
                        base / offline / f'{offline}_{suffix}_{resolution}.jpg'
                        for resolution in ('4k', '2k')
                        for base in (root / 'assets/life/textures/library', root / '.render-work/library')
                    ]
                    selected = next((candidate for candidate in candidates if candidate.exists()), None)
                    if selected is not None:
                        textures[channel] = str(selected)
            for channel, detail in textures.items():
                path = detail.get('path') if isinstance(detail, dict) else detail
                self.file(path, root, f'{label} textures.{channel}')

    def scene(self, source, root, context):
        description = self.json(source, context)
        if description is INVALID_JSON:
            return
        if not isinstance(description, dict):
            self.error(context, 'scene JSON must be an object')
            return
        self.materials(description.get('materials', []), root, context)
        assets = description.get('assets', [])
        if not isinstance(assets, list):
            self.error(context, 'scene assets must be a list')
            return
        for index, asset in enumerate(assets):
            label = f'{context} assets[{index}]'
            identifier = asset.get('id') if isinstance(asset, dict) else None
            if not isinstance(identifier, str) or not identifier.strip() or any(character in identifier for character in '/\\:') or identifier in ('.', '..'):
                self.error(label, 'asset id must be a nonempty local model name')
                continue
            model_dir = root / 'assets' / 'life' / 'models' / identifier
            candidates = [model_dir / f'{identifier}_{resolution}.gltf' for resolution in ('8k', '4k', '2k', '1k')]
            model_path = next((candidate for candidate in candidates if candidate.exists()), candidates[-1])
            self.gltf(self.file(str(model_path), root, label), label)

    def entry(self, entry, context):
        if not isinstance(entry, list) or not entry or not all(isinstance(argument, str) for argument in entry):
            self.error(context, 'queue entry must be a nonempty list of argument strings')
            return
        options = {}
        tracked = ('--scene', '--output', '--blend', '--hdri', '--asset-root', '--nasa-interior')
        index = 0
        while index < len(entry):
            argument = entry[index]
            name, separator, value = argument.partition('=')
            if name in tracked:
                if not separator:
                    if index + 1 >= len(entry) or entry[index + 1].startswith('--'):
                        self.error(context, f'{name} requires a value')
                        index += 1
                        continue
                    index += 1
                    value = entry[index]
                if not value.strip():
                    self.error(context, f'{name} requires a nonempty value')
                else:
                    options[name] = value
            index += 1
        for name in ('--scene', '--output', '--blend'):
            if name not in options:
                self.error(context, f'missing required argument {name}')
        try:
            root = self.resolve(options['--asset-root'], self.workdir) if '--asset-root' in options else self.asset_root
        except (OSError, ValueError) as error:
            self.error(context, f'invalid --asset-root: {error}')
            return
        if '--hdri' in options:
            self.file(options['--hdri'], self.workdir, f'{context} --hdri')
        if '--nasa-interior' in options:
            self.file(options['--nasa-interior'], self.workdir, f'{context} --nasa-interior')
        if '--scene' in options:
            source = self.file(options['--scene'], self.workdir, f'{context} --scene')
            if '--nasa-interior' in options:
                description = self.json(source, context)
                if not isinstance(description, dict) or description.get('scene') != 'spaceship':
                    self.error(context, '--nasa-interior requires a spaceship descriptor')
                if '--proxy-only' in entry or '--measured-terrain' in entry:
                    self.error(context, '--nasa-interior cannot replace the proxy or measured terrain')
            else:
                self.scene(source, root, context)
        self.entries += 1

    def queue(self, value):
        context = f'queue {value}'
        source = self.file(str(value), self.workdir, context)
        entries = self.json(source, context)
        if entries is INVALID_JSON:
            return
        if not isinstance(entries, list) or not entries:
            self.error(context, 'queue JSON must be a nonempty list')
            return
        for index, entry in enumerate(entries):
            self.entry(entry, f'{context} entry[{index}]')


def validate_queues(queues, asset_root=None, required_files=(), workdir=None):
    validation = InputValidation(asset_root or '.', workdir)
    for queue in queues:
        validation.queue(queue)
    for path in required_files:
        validation.file(path, validation.asset_root, '--required-file')
    return validation


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', action='append', required=True, help='Queue JSON; repeat for multiple queues. Scene and HDR paths resolve from cwd.')
    parser.add_argument('--asset-root', default='.', help='Default scene texture/model root (cwd); entry --asset-root overrides it.')
    parser.add_argument('--required-file', action='append', default=[], help='Additional refinement input relative to --asset-root; repeat as needed.')
    options = parser.parse_args(argv)
    validation = validate_queues(options.queue, options.asset_root, options.required_file)
    if validation.errors:
        print(f'RENDER_INPUTS_FAILED: {len(validation.errors)} problem(s)', file=sys.stderr)
        for error in validation.errors:
            print(f'- {error}', file=sys.stderr)
        return 1
    print(f'RENDER_INPUTS_OK: {validation.entries} queue entries; {len(validation.files)} input files checked; no rendering performed')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
