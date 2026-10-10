"""Copy a complete remote map project, reusing verified local files during transfer."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess


REMOTE_INVENTORY = r"""
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise ValueError('Remote project directory does not exist')
files = []
directories = []
for directory, names, filenames in os.walk(str(root)):
    for name in sorted(names + filenames):
        path = Path(directory) / name
        if path.is_symlink():
            raise ValueError('Resolve symbolic links explicitly: ' + str(path))
        relative = path.relative_to(root).as_posix()
        if path.is_dir():
            directories.append(relative)
        elif path.is_file():
            before = path.stat()
            checksum = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    checksum.update(chunk)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('Remote file changed: ' + str(path))
            files.append({'path': relative, 'bytes': before.st_size,
                          'sha256': checksum.hexdigest(), 'mtime_ns': before.st_mtime_ns,
                          'mode': before.st_mode})
        else:
            raise ValueError('Unsupported remote file type: ' + str(path))
print(json.dumps({'source': str(root), 'directories': sorted(directories),
                  'files': sorted(files, key=lambda record: record['path'])}))
"""


def digest_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def remote_inventory(host, source):
    command = "python3 -c " + shlex.quote(REMOTE_INVENTORY) + " " + shlex.quote(source)
    result = subprocess.run(["ssh", host, command], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def destination_path(root, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative:
        raise ValueError("Unsafe snapshot path: " + relative)
    target = root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Snapshot path escapes destination: " + relative)
    return target


def snapshot(host, source, output, reuse, inventory_path):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._@-]*", host):
        raise ValueError("Use a hostname or SSH configuration alias")
    if not PurePosixPath(source).is_absolute():
        raise ValueError("Use an absolute remote project path")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("Snapshot destination must be new or empty")
    inventory = remote_inventory(host, source)
    sizes = {record["bytes"] for record in inventory["files"]}
    candidates = {}
    for directory in reuse:
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.stat().st_size in sizes:
                candidates[digest_file(path)] = path
    output.mkdir(parents=True, exist_ok=True)
    for relative in inventory["directories"]:
        destination_path(output, relative).mkdir(parents=True, exist_ok=True)
    reused = 0
    downloaded = 0
    for record in inventory["files"]:
        target = destination_path(output, record["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        candidate = candidates.get(record["sha256"])
        if candidate is not None:
            shutil.copyfile(candidate, target)
            reused += 1
        else:
            remote_path = str(PurePosixPath(source) / record["path"])
            subprocess.run(["scp", host + ":" + remote_path, str(target)], check=True)
            downloaded += 1
        if target.stat().st_size != record["bytes"] or digest_file(target) != record["sha256"]:
            raise ValueError("Snapshot hash mismatch: " + record["path"])
        os.utime(target, ns=(record["mtime_ns"], record["mtime_ns"]))
    if remote_inventory(host, source) != inventory:
        raise ValueError("Remote project changed during snapshot; take a fresh snapshot")
    inventory["host"] = host
    inventory["excluded_files"] = []
    inventory_path.parent.mkdir(parents=True, exist_ok=True)
    inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"source": source, "files": len(inventory["files"]),
                      "bytes": sum(record["bytes"] for record in inventory["files"]),
                      "reused": reused, "downloaded": downloaded}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse", type=Path, action="append", default=[])
    parser.add_argument("--inventory", type=Path, required=True)
    arguments = parser.parse_args()
    snapshot(arguments.host, arguments.source, arguments.output, arguments.reuse, arguments.inventory)


if __name__ == "__main__":
    main()
