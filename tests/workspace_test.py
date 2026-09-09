import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import workspace


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.destination = self.root / 'guest'
        self.calls = []
        self.execute('git', 'init', '-b', 'main', str(self.source))
        (self.source / 'tracked').write_text('base\n')
        (self.source / '.gitignore').write_text('.env\n.sandbox/\n')
        self.execute('git', '-C', str(self.source), 'add', '.')
        self.execute('git', '-C', str(self.source), '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'base')
        (self.source / 'tracked').write_text('host edit\n')
        (self.source / 'new').write_text('new file\n')
        (self.source / '.env').write_text('excluded\n')
        self.root_patch = patch.object(workspace, 'ROOT', self.source)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def execute(self, *args, **kwargs):
        kwargs.setdefault('check', True)
        kwargs.setdefault('stdout', subprocess.PIPE)
        kwargs.setdefault('stderr', subprocess.PIPE)
        result = subprocess.run(args, **kwargs)
        self.calls.append((args, result))
        return result

    def copy(self, execute=None):
        return workspace.copy_source(execute or self.execute, str(self.destination))

    def test_copy_rejects_nonempty_destination_without_changing_it(self):
        self.destination.mkdir()
        (self.destination / '.env').write_text('foreign file')
        with self.assertRaises(subprocess.CalledProcessError):
            self.copy()
        self.assertEqual((self.destination / '.env').read_text(), 'foreign file')
        self.assertFalse((self.destination / '.git').exists())

    def test_copy_does_not_merge_into_a_destination_created_during_transfer(self):
        def create_destination(*args, **kwargs):
            if args[0] == 'bash' and 'mv "$1" "$2"' in args[2]:
                self.destination.mkdir()
                (self.destination / 'foreign').write_text('preserve')
            return self.execute(*args, **kwargs)
        with self.assertRaises(subprocess.CalledProcessError):
            self.copy(create_destination)
        self.assertEqual(list(self.destination.iterdir()), [self.destination / 'foreign'])
        self.assertEqual(list(self.root.glob('guest.copy.*')), [])

    def test_interrupted_copy_retries_and_completed_copy_preserves_guest_edits(self):
        def fail_apply(*args, **kwargs):
            if args[0] == 'git' and 'apply' in args:
                raise subprocess.CalledProcessError(1, args)
            return self.execute(*args, **kwargs)
        with self.assertRaises(subprocess.CalledProcessError):
            self.copy(fail_apply)
        self.assertFalse(self.destination.exists())
        self.assertEqual(list(self.root.glob('guest.copy.*')), [])
        base = self.copy()
        self.assertEqual((self.destination / 'tracked').read_text(), 'host edit\n')
        self.assertTrue((self.destination / 'new').exists())
        self.assertFalse((self.destination / '.env').exists())
        (self.destination / 'tracked').write_text('guest edit\n')
        self.assertEqual(self.copy(), base)
        self.assertEqual((self.destination / 'tracked').read_text(), 'guest edit\n')

    def test_export_preserves_index_applies_to_base_and_removes_guest_temporary_files(self):
        base = self.copy()
        (self.destination / 'another').write_text('guest file\n')
        self.execute('git', '-C', str(self.destination), 'add', 'another')
        index = (self.destination / '.git/index').read_bytes()
        exported = workspace.export_source(self.execute, str(self.destination), 'test')
        self.assertEqual((self.destination / '.git/index').read_bytes(), index)
        checkout = self.root / 'export-check'
        self.execute('git', 'clone', str(exported / 'commits.bundle'), str(checkout))
        self.execute('git', '-C', str(checkout), 'checkout', '--detach', base)
        self.execute('git', '-C', str(checkout), 'apply', str(exported / 'changes.patch'))
        self.assertEqual((checkout / 'another').read_text(), 'guest file\n')
        temporary = next(result.stdout.decode().strip() for args, result in self.calls if args[0] == 'bash' and 'export_dir=' in args[2])
        self.assertFalse(Path(temporary).exists())


class LifecycleTests(unittest.TestCase):
    def test_seed_resumes_after_dependency_installation_failure(self):
        for filename in ['sandbox.py', 'macos-sandbox.py']:
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                spec = importlib.util.spec_from_file_location('sandbox_under_test', SCRIPTS / filename)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                root = Path(temporary)
                (root / '.sandbox').mkdir()
                name = 'helixium-recovery'
                state = root / '.sandbox' / f'{name}.json'
                state.write_text(json.dumps({'name': name, 'agent': 'codex', 'template': '', 'phase': 'created'}))
                failed = False
                def run(*args, **kwargs):
                    nonlocal failed
                    installing = 'ci' in args or any(str(arg).endswith('/sandbox/macos-install.sh') for arg in args)
                    if installing and not failed:
                        failed = True
                        raise subprocess.CalledProcessError(1, args)
                    return subprocess.CompletedProcess(args, 0, b'')
                with patch.object(module, 'ROOT', root), patch.object(module, 'run', run), patch.object(module, 'copy_source', return_value='a' * 40), patch.object(sys, 'argv', [filename, 'seed', name]):
                    with self.assertRaises(subprocess.CalledProcessError):
                        module.main()
                    self.assertEqual(json.loads(state.read_text())['phase'], 'copied')
                    module.main()
                    self.assertEqual(json.loads(state.read_text())['phase'], 'ready')
                    self.assertEqual(json.loads(state.read_text())['base'], 'a' * 40)

    def test_failed_creation_retains_ownership_and_removal_handles_partial_resources(self):
        for filename, create_command in [('sandbox.py', 'env'), ('macos-sandbox.py', 'clone')]:
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                spec = importlib.util.spec_from_file_location('sandbox_under_test', SCRIPTS / filename)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                name = 'helixium-recovery'
                calls = []
                resource_exists = False
                def run(*args, **kwargs):
                    nonlocal resource_exists
                    calls.append(args)
                    if 'ls' in args:
                        value = {'sandboxes': [{'name': name}] if resource_exists else []}
                    elif 'list' in args:
                        value = [{'Name': name, 'Running': False}] if resource_exists else []
                    elif args[1] == create_command:
                        resource_exists = True
                        raise subprocess.CalledProcessError(1, args)
                    else:
                        value = None
                    return subprocess.CompletedProcess(args, 0, json.dumps(value).encode())
                with patch.object(module, 'ROOT', Path(temporary)), patch.object(module, 'run', run), patch.object(module, 'export_source', return_value=None), patch.object(sys, 'argv', [filename, 'create', name]):
                    with self.assertRaises(subprocess.CalledProcessError):
                        module.main()
                    state = Path(temporary) / '.sandbox' / f'{name}.json'
                    self.assertEqual(json.loads(state.read_text())['phase'], 'creating')
                    # The Linux remover delegates its export through execute().
                    if filename == 'sandbox.py':
                        with patch.object(module, 'export', return_value=None), patch.object(sys, 'argv', [filename, 'remove', name]):
                            # Only creation fails; removal uses sbx env rm.
                            create_command = 'unused'
                            module.main()
                    else:
                        with patch.object(sys, 'argv', [filename, 'remove', name]):
                            module.main()
                    self.assertFalse(state.exists())
                    self.assertTrue(any('delete' in call or 'rm' in call for call in calls))
