import copy
import io
import json
import unittest
from unittest.mock import patch
import zipfile

import release as r

REPO = 'RobbanHoglund/devspace-analyzer'
SHA = 'a' * 40
VERSION = '1.0.0'


def run(workflow='vscode.yml', **changes):
    return dict({'id': 123, 'run_number': 20, 'run_attempt': 1, 'head_sha': SHA,
        'event': 'push', 'head_branch': 'main', 'head_repository': {'full_name': REPO},
        'path': f'.github/workflows/{workflow}', 'status': 'completed', 'conclusion': 'success',
        'html_url': 'https://github.com/example/run'}, **changes)


def zipped(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def package(target, revision=SHA, preview=False):
    binary = 'devspace-scan.exe' if target == 'win32-x64' else 'devspace-scan'
    return zipped({
        'extension/package.json': json.dumps({'name': 'devspace-analyzer', 'publisher': 'RobbanHoglund',
            'version': VERSION, 'preview': preview, 'license': 'Apache-2.0'}),
        'extension/bin/build.json': json.dumps({'revision': revision, 'target': target, 'protocolVersion': 1}),
        'extension.vsixmanifest': f'<PackageManifest xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Version="{VERSION}" TargetPlatform="{target}" Publisher="RobbanHoglund"/><License>extension/LICENSE.txt</License></Metadata></PackageManifest>',
        'extension/LICENSE.txt': (r.ROOT / 'LICENSE').read_bytes(),
        'extension/NOTICE': (r.ROOT / 'NOTICE').read_bytes(),
        'extension/THIRD_PARTY_NOTICES.txt': 'Third party license text\n' * 10,
        f'extension/bin/{binary}': b'fixture, never executed',
    })


class ReleaseTests(unittest.TestCase):
    def test_only_successful_own_main_push_or_manual_main_can_trigger(self):
        event = {'workflow_run': run()}
        r.validate_context('workflow_run', event, REPO, SHA, 'refs/heads/main')
        r.validate_context('workflow_dispatch', {}, REPO, SHA, 'refs/heads/main')
        for change in ({'event': 'pull_request'}, {'head_branch': 'feature'}, {'head_sha': 'b' * 40},
                       {'conclusion': 'failure'}, {'head_repository': {'full_name': 'someone/fork'}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                r.validate_context('workflow_run', {'workflow_run': run(**change)}, REPO, SHA, 'refs/heads/main')
        with self.assertRaises(ValueError):
            r.validate_context('workflow_dispatch', {}, REPO, SHA, 'refs/heads/feature')

    def test_newer_failure_or_pending_attempt_cannot_reuse_old_success(self):
        for changes in ({'status': 'in_progress', 'conclusion': None, 'run_attempt': 2},
                        {'conclusion': 'failure', 'run_attempt': 2}, {'conclusion': 'failure', 'run_number': 21}):
            self.assertIsNone(r.successful_run([run(), run(**changes)], REPO, SHA, 'vscode.yml'))
        self.assertIsNone(r.successful_run([run(event='pull_request')], REPO, SHA, 'vscode.yml'))
        self.assertIsNone(r.successful_run([run(head_sha='b' * 40)], REPO, SHA, 'vscode.yml'))

    def test_artifacts_must_be_complete_unique_unexpired_and_from_exact_source(self):
        artifacts = [{'id': i, 'name': f'devspace-vscode-{target}', 'expired': False,
            'workflow_run': {'head_sha': SHA}, 'digest': 'sha256:' + 'c' * 64} for i, target in enumerate(r.TARGETS)]
        self.assertEqual(len(r.select_artifacts(artifacts, SHA)), 4)
        for bad in (artifacts[:-1], artifacts + [artifacts[0]]):
            with self.assertRaises(ValueError):
                r.select_artifacts(bad, SHA)
        for change in ({'expired': True}, {'digest': None}, {'workflow_run': {'head_sha': 'b' * 40}}):
            bad = copy.deepcopy(artifacts); bad[0].update(change)
            with self.assertRaises(ValueError):
                r.select_artifacts(bad, SHA)

    def test_all_platform_packages_validate_without_executing_binaries(self):
        for target in r.TARGETS:
            r.validate_vsix(package(target), VERSION, target, SHA)

    def test_wrong_revision_platform_preview_and_corrupt_artifact_are_rejected(self):
        for data in (package('win32-x64', revision='b' * 40), package('win32-x64', preview=True), package('linux-x64')):
            with self.assertRaises(ValueError):
                r.validate_vsix(data, VERSION, 'win32-x64', SHA)
        filename = f'devspace-analyzer-{VERSION}-win32-x64.vsix'
        archive = zipped({filename: package('win32-x64')})
        self.assertEqual(r.unpack_artifact(archive, {'digest': r.digest(archive)}, VERSION, 'win32-x64', SHA)[0], filename)
        with self.assertRaises(ValueError):
            r.unpack_artifact(archive + b'corrupted', {'digest': r.digest(archive)}, VERSION, 'win32-x64', SHA)
        archive = zipped({'../' + filename: package('win32-x64')})
        with self.assertRaises(ValueError):
            r.unpack_artifact(archive, {'digest': r.digest(archive)}, VERSION, 'win32-x64', SHA)

    def test_existing_release_must_be_unpublished_and_same_revision(self):
        draft = {'tag_name': f'v{VERSION}', 'draft': True, 'prerelease': False, 'target_commitish': SHA}
        self.assertEqual(r.existing_draft([draft], VERSION, SHA), draft)
        for change in ({'draft': False}, {'target_commitish': 'b' * 40}, {'prerelease': True}):
            with self.assertRaises(ValueError):
                r.existing_draft([{**draft, **change}], VERSION, SHA)

    def test_retry_only_adds_missing_identical_assets(self):
        files = {'a.vsix': b'a', 'b.vsix': b'b'}
        asset = {'name': 'a.vsix', 'state': 'uploaded', 'digest': r.digest(b'a')}
        self.assertEqual(r.missing_assets([asset], files), ['b.vsix'])
        for existing in ([{**asset, 'digest': r.digest(b'other')}], [{**asset, 'name': 'desktop.exe'}], [asset, asset]):
            with self.assertRaises(ValueError):
                r.missing_assets(existing, files)

    def test_prepare_draft_uploads_checksums_and_is_idempotent(self):
        artifacts, archives = [], {}
        for i, target in enumerate(r.TARGETS):
            name = f'devspace-analyzer-{VERSION}-{target}.vsix'
            data = zipped({name: package(target)})
            artifacts.append({'id': i, 'name': f'devspace-vscode-{target}', 'expired': False,
                'workflow_run': {'head_sha': SHA}, 'digest': r.digest(data)})
            archives[f'repos/{REPO}/actions/artifacts/{i}/zip'] = data
        releases, assets, uploads, posts = [], [], {}, []

        def fake_api(endpoint, data=None):
            if endpoint.endswith('/git/ref/heads/main'):
                return {'object': {'sha': SHA}}
            if '/git/matching-refs/' in endpoint:
                return []
            if endpoint.endswith('/releases') and data:
                self.assertIs(data['draft'], True)
                posts.append(data)
                draft = {**data, 'id': 9, 'html_url': 'https://github.com/example/draft'}
                releases.append(draft)
                return draft
            if endpoint.endswith('/releases/9'):
                return releases[0]
            self.fail(f'Unexpected API call: {endpoint}')

        def fake_pages(endpoint):
            for workflow in r.WORKFLOWS:
                if f'/workflows/{workflow}/runs?' in endpoint:
                    return [{'workflow_runs': [run(workflow)]}]
            if '/actions/runs/' in endpoint:
                return [{'artifacts': artifacts}]
            if '/releases/9/assets?' in endpoint:
                return [assets]
            if '/releases?' in endpoint:
                return [releases]
            self.fail(f'Unexpected paginated call: {endpoint}')

        def fake_command(*args, **kwargs):
            if args == ('git', 'rev-parse', 'HEAD'):
                return SHA.encode()
            if args[:2] == ('gh', 'api'):
                return archives[args[2]]
            self.assertEqual(args[:4], ('gh', 'release', 'upload', f'v{VERSION}'))
            self.assertNotIn('--clobber', args)
            path = r.Path(args[4]); data = path.read_bytes(); uploads[path.name] = data
            assets.append({'name': path.name, 'state': 'uploaded', 'digest': r.digest(data)})
            return b''

        with patch.object(r, 'api', fake_api), patch.object(r, 'pages', fake_pages), patch.object(r, 'command', fake_command):
            r.prepare(REPO, SHA)
            r.prepare(REPO, SHA)
        self.assertEqual(len(posts), 1)
        self.assertEqual(len(assets), 6)
        provenance = json.loads(uploads['SOURCE.json'])
        self.assertEqual(provenance['revision'], SHA)
        for line in uploads['SHA256SUMS'].decode().splitlines():
            checksum, name = line.split('  ')
            self.assertEqual(checksum, r.digest(uploads[name])[7:])

    def test_prepare_does_not_mutate_when_main_moves_or_other_ci_is_pending(self):
        with patch.object(r, 'command', return_value=SHA.encode()), patch.object(r, 'api') as api, patch.object(r, 'pages') as pages:
            api.return_value = {'object': {'sha': 'b' * 40}}
            r.prepare(REPO, SHA)
            pages.assert_not_called()
            api.return_value = {'object': {'sha': SHA}}
            pages.return_value = [{'workflow_runs': []}]
            r.prepare(REPO, SHA)
            self.assertTrue(all(len(c.args) == 1 for c in api.call_args_list))


if __name__ == '__main__':
    unittest.main()
