"""Prepare a draft from verified main CI artifacts. Never publish a release."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ('win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64')
WORKFLOWS = ('ci.yml', 'vscode.yml')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def license_text(data):
    # Git for Windows may check text out with CRLF. Validate the full license
    # content without requiring the Linux and Windows line endings to match.
    return data.decode('utf-8').replace('\r\n', '\n')


def command(*args, input_data=None):
    return subprocess.run(args, input=input_data, check=True, capture_output=True).stdout


def api(endpoint, data=None):
    args = ['gh', 'api', endpoint]
    if data is not None:
        args += ['--method', 'POST', '--input', '-']
    return json.loads(command(*args, input_data=None if data is None else json.dumps(data).encode()))


def pages(endpoint):
    return json.loads(command('gh', 'api', endpoint, '--paginate', '--slurp'))


def validate_context(event_name, event, repository, sha, ref):
    require(repository == 'RobbanHoglund/devspace-analyzer', 'Unexpected release repository.')
    require(re.fullmatch(r'[0-9a-f]{40}', sha), 'Expected an exact source commit.')
    if event_name == 'workflow_dispatch':
        require(ref == 'refs/heads/main', 'Manual releases must use main.')
    else:
        require(event_name == 'workflow_run', 'Unsupported release event.')
        run = event.get('workflow_run', {})
        require(run.get('event') == 'push' and run.get('head_branch') == 'main'
                and run.get('head_sha') == sha and run.get('conclusion') == 'success'
                and run.get('head_repository', {}).get('full_name') == repository,
                'Release trigger is not a successful push to this repository main.')


def successful_run(runs, repository, sha, workflow):
    # Do not select an older success if a newer run/attempt is pending or failed.
    matching = [r for r in runs if r.get('head_sha') == sha and r.get('event') == 'push'
                and r.get('head_branch') == 'main'
                and r.get('head_repository', {}).get('full_name') == repository
                and r.get('path') == f'.github/workflows/{workflow}']
    latest = max(matching, key=lambda r: (r['run_number'], r['run_attempt']), default=None)
    return latest if latest and latest['status'] == 'completed' and latest['conclusion'] == 'success' else None


def select_artifacts(artifacts, sha):
    selected = []
    for target in TARGETS:
        matches = [a for a in artifacts if a['name'] == f'devspace-vscode-{target}' and not a['expired']]
        require(len(matches) == 1, f'Expected one available artifact for {target}.')
        artifact = matches[0]
        require(artifact.get('workflow_run', {}).get('head_sha') == sha, 'Artifact source does not match.')
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', artifact.get('digest') or ''), 'Missing artifact digest.')
        selected.append((target, artifact))
    return selected


def validate_vsix(data, version, target, sha):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        names = package.namelist()
        require(len(names) == len(set(names)), 'Duplicate package entries.')
        require(sum(f.file_size for f in package.infolist()) < 100_000_000, 'Unexpected VSIX size.')
        pkg = json.loads(package.read('extension/package.json'))
        require(pkg['name'] == 'devspace-analyzer' and pkg['publisher'] == 'RobbanHoglund'
                and pkg['version'] == version and pkg.get('preview') is False
                and pkg['license'] == 'Apache-2.0', 'Incorrect GA package metadata.')
        build = json.loads(package.read('extension/bin/build.json'))
        require(build['revision'] == sha and build['target'] == target and build['protocolVersion'] == 1,
                'Bundled scanner provenance does not match.')
        manifest = ET.fromstring(package.read('extension.vsixmanifest'))
        identity = manifest.find('.//{*}Identity')
        require(identity is not None and identity.get('Version') == version
                and identity.get('TargetPlatform') == target and identity.get('Publisher') == 'RobbanHoglund',
                'Incorrect VSIX manifest.')
        # vsce normalizes LICENSE to LICENSE.txt and records its actual path.
        license_path = manifest.findtext('.//{*}License')
        require(license_path in ('extension/LICENSE', 'extension/LICENSE.txt'), 'Missing VSIX license reference.')
        require(license_text(package.read(license_path)) == license_text((ROOT / 'LICENSE').read_bytes()), 'Incorrect bundled LICENSE.')
        require(license_text(package.read('extension/NOTICE')) == license_text((ROOT / 'NOTICE').read_bytes()), 'Incorrect bundled NOTICE.')
        require(len(package.read('extension/THIRD_PARTY_NOTICES.txt')) > 100, 'Third-party notices missing.')
        scanner = 'devspace-scan.exe' if target == 'win32-x64' else 'devspace-scan'
        require(package.getinfo(f'extension/bin/{scanner}').file_size > 0, 'Scanner missing.')
        require(not any(re.search(r'(^|/)cleanup\.js$', name) for name in names), 'Obsolete cleanup runner included.')


def unpack_artifact(data, artifact, version, target, sha):
    require(digest(data) == artifact['digest'], 'Artifact digest does not match GitHub.')
    filename = f'devspace-analyzer-{version}-{target}.vsix'
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(len(files) == 1 and files[0].filename == filename and files[0].file_size < 50_000_000,
                'Unexpected artifact contents.')
        vsix = archive.read(filename)
    validate_vsix(vsix, version, target, sha)
    return filename, vsix


def existing_draft(releases, version, sha):
    matches = [r for r in releases if r['tag_name'] == f'v{version}']
    require(len(matches) <= 1, 'Multiple releases share this version.')
    if not matches:
        return None
    release = matches[0]
    require(release['draft'], 'This version is already published; bump the version for a new release.')
    require(release['target_commitish'] == sha and not release['prerelease'],
            'Existing draft targets another revision; review it before retrying.')
    return release


def missing_assets(existing, files):
    require(len({a['name'] for a in existing}) == len(existing), 'Duplicate release asset names.')
    by_name = {a['name']: a for a in existing}
    require(set(by_name) <= set(files), 'Draft contains unexpected assets.')
    for name, asset in by_name.items():
        require(asset['state'] == 'uploaded' and asset.get('digest') == digest(files[name]),
                f'Existing asset differs: {name}. No assets were overwritten.')
    return sorted(set(files) - set(by_name))


def prepare(repository, sha):
    prefix = f'repos/{repository}'
    require(command('git', 'rev-parse', 'HEAD').decode().strip() == sha, 'Checkout is not the requested revision.')
    if api(f'{prefix}/git/ref/heads/main')['object']['sha'] != sha:
        print('Main has moved; the current main workflows will prepare its draft.')
        return
    runs = {}
    for workflow in WORKFLOWS:
        all_runs = [r for page in pages(f'{prefix}/actions/workflows/{workflow}/runs?branch=main&event=push&head_sha={sha}&per_page=100') for r in page['workflow_runs']]
        runs[workflow] = successful_run(all_runs, repository, sha, workflow)
    if not all(runs.values()):
        print('Waiting for both required main workflows to succeed. The other completion event retries automatically.')
        return
    pkg = json.loads((ROOT / 'vscode/package.json').read_text())
    version = pkg['version']
    require(re.fullmatch(r'[1-9][0-9]*\.[0-9]+\.[0-9]+', version)
            and pkg.get('preview') is False and pkg['license'] == 'Apache-2.0', 'Not a stable GA manifest.')
    require(json.loads((ROOT / 'package.json').read_text())['version'] == version, 'Source versions differ.')
    notes = (ROOT / f'docs/releases/{version}.md').read_text()
    releases = [r for page in pages(f'{prefix}/releases?per_page=100') for r in page]
    release = existing_draft(releases, version, sha)
    # Refuse existing tags, including annotated tags, that do not point directly
    # to this source. Never create, move or delete a tag ourselves.
    tags = api(f'{prefix}/git/matching-refs/tags/v{version}')
    for tag in tags:
        if tag['ref'] == f'refs/tags/v{version}':
            require(tag['object']['type'] == 'commit' and tag['object']['sha'] == sha, 'Version tag targets different source.')
    vsix_run = runs['vscode.yml']
    artifacts = [a for page in pages(f"{prefix}/actions/runs/{vsix_run['id']}/artifacts?per_page=100") for a in page['artifacts']]
    files, evidence = {}, []
    for target, artifact in select_artifacts(artifacts, sha):
        data = command('gh', 'api', f"{prefix}/actions/artifacts/{artifact['id']}/zip")
        name, vsix = unpack_artifact(data, artifact, version, target, sha)
        files[name] = vsix
        evidence.append({'name': name, 'sha256': digest(vsix), 'artifactId': artifact['id'], 'artifactDigest': artifact['digest']})
    files['SOURCE.json'] = (json.dumps({'version': version, 'revision': sha,
        'workflows': {w: {'id': r['id'], 'attempt': r['run_attempt'], 'url': r['html_url']} for w, r in runs.items()},
        'packages': evidence}, indent=2) + '\n').encode()
    files['SHA256SUMS'] = ''.join(f'{digest(data)[7:]}  {name}\n' for name, data in sorted(files.items())).encode()
    # Recheck main and both latest attempts immediately before any mutation.
    require(api(f'{prefix}/git/ref/heads/main')['object']['sha'] == sha, 'Main moved during artifact validation.')
    for workflow, run in runs.items():
        latest = [r for page in pages(f'{prefix}/actions/workflows/{workflow}/runs?branch=main&event=push&head_sha={sha}&per_page=100') for r in page['workflow_runs']]
        checked = successful_run(latest, repository, sha, workflow)
        require(checked and (checked['id'], checked['run_attempt']) == (run['id'], run['run_attempt']), 'CI changed during artifact validation.')
    if release is None:
        release = api(f'{prefix}/releases', {'tag_name': f'v{version}', 'target_commitish': sha,
            'name': f'DevSpace Analyzer {version} for VS Code', 'draft': True, 'prerelease': False,
            'body': notes + f'\n\nSource: `{sha}`. See `SOURCE.json` for CI and artifact provenance.\n'})
    # A retry fills only missing identical assets. It never overwrites a draft
    # from another commit or touches a published release.
    with tempfile.TemporaryDirectory(prefix='devspace-release-') as folder:
        for name in sorted(files):
            current = api(f"{prefix}/releases/{release['id']}")
            existing_draft([current], version, sha)
            assets = [a for page in pages(f"{prefix}/releases/{release['id']}/assets?per_page=100") for a in page]
            if name in missing_assets(assets, files):
                path = Path(folder) / name
                path.write_bytes(files[name])
                command('gh', 'release', 'upload', f'v{version}', str(path), '--repo', repository)
    current = api(f"{prefix}/releases/{release['id']}")
    existing_draft([current], version, sha)
    assets = [a for page in pages(f"{prefix}/releases/{release['id']}/assets?per_page=100") for a in page]
    require(not missing_assets(assets, files), 'Release assets are incomplete.')
    message = f"Draft ready: {current['html_url']}\n\nFour VSIX packages, checksums and source provenance verified. Nothing was published.\n"
    print(message)
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
            summary.write(message)


if __name__ == '__main__':
    repository, sha = os.environ['GITHUB_REPOSITORY'], os.environ['RELEASE_SHA']
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    validate_context(os.environ['GITHUB_EVENT_NAME'], event, repository, sha, os.environ['GITHUB_REF'])
    prepare(repository, sha)
