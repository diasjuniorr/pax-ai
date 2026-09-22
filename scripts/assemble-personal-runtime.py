#!/usr/bin/env python3
"""Build a personal runtime ZIP on the development host, never on the gaming laptop.

Inputs: verified GitHub build artifact and the pinned official SDK ZIP.
Requires Python 3 and cabextract on this development host only. No SDK installer runs.
Microsoft files are matched by both size and SHA-256 from the Windows build manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def assemble(build, sdk, output, existing_runtime=None):
    manifest_path = build / 'build-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    if manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported build manifest; download the current assembly inputs')
    if not re.fullmatch(r'[0-9a-f]{40}', manifest['commit']):
        raise ValueError('Invalid commit in manifest')
    expected_vendor = {'SimConnect.dll', 'Microsoft.FlightSimulator.SimConnect.dll', 'MSFS-SDK-EULA.pdf'}
    entries = manifest['files']
    if len({item['name'] for item in entries}) != len(entries):
        raise ValueError('Duplicate package filenames')
    for item in entries:
        if not re.fullmatch(r'[A-Za-z0-9._-]+', item['name']) or item['name'] in {'.', '..'}:
            raise ValueError('Unsafe package filename')
        if item['source'] not in {'MicrosoftSDK', 'PAX'}:
            raise ValueError('Unknown file source')
    vendor = {item['name']: item for item in entries if item['source'] == 'MicrosoftSDK'}
    if set(vendor) != expected_vendor:
        raise ValueError('Unexpected SDK runtime file set')
    extractor = None
    if sdk is not None:
        if digest(sdk).lower() != manifest['sdkSha256'].lower():
            raise ValueError('Official SDK archive checksum mismatch')
        extractor = shutil.which('cabextract')
        if not extractor:
            raise ValueError('Install cabextract on the development host, not the gaming laptop')
    elif existing_runtime is None:
        raise ValueError('Supply the official SDK archive or an existing personal runtime ZIP')
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"PAX-windows-x64-{manifest['commit'][:12]}.zip"
    if target.exists():
        raise ValueError(f'Output already exists: {target}')
    with tempfile.TemporaryDirectory(prefix='pax-runtime-') as temporary:
        work = Path(temporary)
        stage = work / 'runtime'
        stage.mkdir()
        for item in entries:
            if item['source'] == 'PAX':
                shutil.copyfile(build / item['name'], stage / item['name'])
        if existing_runtime is not None:
            # Reuse only the three vendor inputs, checked against the NEW CI manifest.
            with zipfile.ZipFile(existing_runtime) as archive:
                for item in vendor.values():
                    member = archive.getinfo(item['name'])
                    if member.file_size != item['bytes']:
                        raise ValueError('Existing runtime input size mismatch')
                    (stage / item['name']).write_bytes(archive.read(member))
        else:
            cabinets = work / 'cabinets'
            cabinets.mkdir()
            # Extract only official CAB files; do not install or retain SDK tooling.
            with zipfile.ZipFile(sdk) as archive:
                for member in archive.infolist():
                    name = Path(member.filename).name
                    if re.fullmatch(r'cab[0-9]+\.cab', name):
                        if (cabinets / name).exists():
                            raise ValueError('Duplicate SDK cabinet name')
                        with archive.open(member) as source, (cabinets / name).open('wb') as destination:
                            shutil.copyfileobj(source, destination)
            candidates = work / 'candidates'
            candidates.mkdir()
            pending = {item['sha256'].lower(): item for item in vendor.values()}
            for cabinet in sorted(cabinets.glob('*.cab')):
                listing = subprocess.run([extractor, '-l', str(cabinet)], check=True, capture_output=True, text=True).stdout
                for line in listing.splitlines():
                    match = re.match(r'\s*(\d+)\s*\|[^|]+\|\s*(\S+)\s*$', line)
                    if not match or int(match[1]) not in {item['bytes'] for item in pending.values()}:
                        continue
                    name = match[2]
                    if Path(name).name != name or '/' in name or '\\' in name:
                        raise ValueError('Unsafe cabinet filename')
                    subprocess.run([extractor, '-q', '-F', name, '-d', str(candidates), str(cabinet)], check=True, capture_output=True)
                    source = candidates / name
                    checksum = digest(source)
                    if checksum in pending:
                        item = pending.pop(checksum)
                        shutil.copyfile(source, stage / item['name'])
                        print(f"Verified official runtime input: {item['name']}")
                if not pending:
                    break
            if pending:
                raise ValueError('Official archive did not supply every expected runtime file')
        for item in entries:
            path = stage / item['name']
            if path.stat().st_size != item['bytes'] or digest(path).lower() != item['sha256'].lower():
                raise ValueError(f"Package file verification failed: {item['name']}")
        shutil.copyfile(manifest_path, stage / 'build-manifest.json')
        with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.iterdir()):
                info = zipfile.ZipInfo(path.name)
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
    checksum = digest(target)
    target.with_suffix('.zip.sha256').write_text(f'{checksum}  {target.name}\n')
    print(f'Personal runtime ZIP: {target}\nSHA-256: {checksum}')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', required=True, type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--sdk', type=Path)
    source.add_argument('--existing-runtime', type=Path, help='Reuse vendor files only after verifying them against the new CI manifest')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    assemble(args.build.resolve(), args.sdk.resolve() if args.sdk else None, args.output.resolve(),
             args.existing_runtime.resolve() if args.existing_runtime else None)
