"""Archive every file in map projects, deduplicating bytes and splitting large files."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "tools/relief-atlas/full-archive"
PART_BYTES = 48 * 1024 * 1024
BINARY_SUFFIXES = {".blend", ".npz", ".png", ".jpg", ".jpeg", ".webp", ".zip"}


def digest_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(root):
    entries = sorted(root.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise ValueError(f"Resolve symbolic links explicitly before archiving {root}")
    return [path for path in entries if path.is_file()], [path for path in entries if path.is_dir()]


def checked_path(root, relative):
    parts = PurePosixPath(relative).parts
    if not parts or PurePosixPath(relative).is_absolute() or any(part in {".", ".."} for part in parts) or "\\" in relative or ":" in relative:
        raise ValueError(f"Unsafe archive path: {relative}")
    path = root.joinpath(*parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Archive path escapes its root: {relative}")
    return path


def reference_index():
    result = {}
    for directory in (ROOT / "tools/relief-atlas/reference", ROOT / "tools/relief-atlas/footprints"):
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.suffix.lower() in BINARY_SUFFIXES and path.stat().st_size < 100*1024*1024:
                result[digest_file(path)] = path
    return result


def archive(sources):
    DESTINATION.mkdir(parents=True, exist_ok=True)
    objects = DESTINATION / "objects"
    objects.mkdir(exist_ok=True)
    references = reference_index()
    totals = {}
    for specification in sources:
        name, source_text = specification.split("=", 1)
        if not name or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in name):
            raise ValueError("Archive names must contain lowercase letters, digits or hyphens")
        source = Path(source_text).resolve()
        if not source.is_dir() or DESTINATION.resolve().is_relative_to(source):
            raise ValueError("Source must be an existing directory outside the archive destination")
        files, directories = inventory(source)
        records = []
        for path in files:
            before = path.stat()
            checksum = digest_file(path)
            parts = []
            if checksum in references:
                reference = references[checksum]
                parts.append({"path": reference.relative_to(ROOT).as_posix(), "bytes": before.st_size, "sha256": checksum})
            else:
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(PART_BYTES), b""):
                        chunk_hash = hashlib.sha256(chunk).hexdigest()
                        object_path = objects / (chunk_hash + ".part")
                        if object_path.exists():
                            if digest_file(object_path) != chunk_hash:
                                raise ValueError(f"Corrupt existing archive object: {object_path}")
                        else:
                            with object_path.open("xb") as output:
                                output.write(chunk)
                        parts.append({"path": object_path.relative_to(ROOT).as_posix(), "bytes": len(chunk), "sha256": chunk_hash})
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError(f"Source changed during archive: {path}")
            records.append({"path": path.relative_to(source).as_posix(), "bytes": before.st_size,
                            "sha256": checksum, "mtime_ns": before.st_mtime_ns, "mode": before.st_mode,
                            "parts": parts})
        current_files, current_directories = inventory(source)
        if current_files != files or current_directories != directories:
            raise ValueError(f"Source inventory changed during archive: {source}")
        manifest = {"version": 1, "name": name, "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": str(source), "excluded_files": [], "chunk_bytes": PART_BYTES,
                    "directories": [path.relative_to(source).as_posix() for path in directories],
                    "files": records, "file_count": len(records), "total_bytes": sum(record["bytes"] for record in records)}
        (DESTINATION / (name + ".json")).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        totals[name] = {"files": manifest["file_count"], "bytes": manifest["total_bytes"]}
        print(json.dumps({name: totals[name]}), flush=True)
    return totals


def verify(manifest_path, compare_source=None):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["version"] == 1 and manifest["excluded_files"] == []
    assert manifest["file_count"] == len(manifest["files"])
    assert len({record["path"] for record in manifest["files"]}) == manifest["file_count"]
    assert manifest["total_bytes"] == sum(record["bytes"] for record in manifest["files"])
    for record in manifest["files"]:
        digest = hashlib.sha256()
        total = 0
        for part in record["parts"]:
            source = checked_path(ROOT, part["path"])
            part_digest = hashlib.sha256()
            size = 0
            with source.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024*1024), b""):
                    digest.update(chunk)
                    part_digest.update(chunk)
                    size += len(chunk)
            assert size == part["bytes"] and part_digest.hexdigest() == part["sha256"], part["path"]
            total += size
        assert total == record["bytes"] and digest.hexdigest() == record["sha256"], record["path"]
    if compare_source is not None:
        files, directories = inventory(compare_source)
        assert {path.relative_to(compare_source).as_posix() for path in files} == {record["path"] for record in manifest["files"]}
        assert {path.relative_to(compare_source).as_posix() for path in directories} == set(manifest["directories"])
        for record in manifest["files"]:
            assert digest_file(checked_path(compare_source, record["path"])) == record["sha256"], record["path"]
    print(f"VERIFIED {manifest['name']}: {manifest['file_count']} files, {manifest['total_bytes']} bytes", flush=True)
    return manifest


def restore(manifest_path, output):
    manifest = verify(manifest_path)
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("Restore destination must be new or empty")
    output.mkdir(parents=True, exist_ok=True)
    for relative in manifest["directories"]:
        checked_path(output, relative).mkdir(parents=True, exist_ok=True)
    for record in manifest["files"]:
        destination = checked_path(output, record["path"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as target:
            for part in record["parts"]:
                with checked_path(ROOT, part["path"]).open("rb") as source:
                    shutil.copyfileobj(source, target, 1024*1024)
        assert digest_file(destination) == record["sha256"]
        os.utime(destination, ns=(record["mtime_ns"], record["mtime_ns"]))
        if os.name != "nt":
            os.chmod(destination, record["mode"] & 0o777)
    verify(manifest_path, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    creation = commands.add_parser("archive")
    creation.add_argument("--source", action="append", required=True, help="Archive name=directory, without exclusions")
    validation = commands.add_parser("verify")
    validation.add_argument("manifest", type=Path)
    validation.add_argument("--compare-source", type=Path)
    extraction = commands.add_parser("restore")
    extraction.add_argument("manifest", type=Path)
    extraction.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.command == "archive":
        archive(arguments.source)
    elif arguments.command == "verify":
        verify(arguments.manifest, arguments.compare_source)
    else:
        restore(arguments.manifest, arguments.output)


if __name__ == "__main__":
    main()
