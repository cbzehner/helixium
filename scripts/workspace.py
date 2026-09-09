"""Copy and export a Git workspace through a guest command transport."""

from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args, **kwargs):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, **kwargs)


def copied_base(execute, workspace):
    return execute("bash", "-ec", 'if [ -f "$1" ]; then cat "$1"; fi', "_",
                   f"{workspace}/.git/helixium-base", stdout=subprocess.PIPE).stdout.decode().strip()


def copy_source(execute, workspace):
    # The marker moves with the checkout, so retries never overwrite guest work.
    base = copied_base(execute, workspace)
    if base:
        execute("git", "-C", workspace, "cat-file", "-e", f"{base}^{{commit}}")
        return base
    execute("bash", "-ec", '''
        test ! -L "$1"
        if [ -e "$1" ]; then rmdir "$1"; fi
        mkdir -p "$(dirname "$1")"
    ''', "_", workspace)
    base = git("rev-parse", "HEAD", stdout=subprocess.PIPE).stdout.decode().strip()
    patch = git("diff", "--binary", "--no-ext-diff", "HEAD", stdout=subprocess.PIPE).stdout
    untracked = git("ls-files", "--others", "--exclude-standard", "-z", stdout=subprocess.PIPE).stdout
    staged = execute("mktemp", "-d", f"{workspace}.copy.XXXXXX", stdout=subprocess.PIPE).stdout.decode().strip()
    try:
        with tempfile.TemporaryDirectory(prefix="helixium-source-") as temporary:
            bundle = Path(temporary) / "source.bundle"
            git("bundle", "create", str(bundle), "HEAD")
            with bundle.open("rb") as stream:
                execute("sh", "-c", 'cat > "$1/source.bundle"', "_", staged, stdin=stream)
            execute("bash", "-ec", '''
                cd "$1"
                git init -b main
                git fetch source.bundle HEAD
                git reset --hard FETCH_HEAD
                rm source.bundle
            ''', "_", staged)
            if patch:
                execute("git", "-C", staged, "apply", "--binary", "--whitespace=nowarn", "-", input=patch)
            archive = Path(temporary) / "untracked.tar"
            with tarfile.open(archive, "w") as tar:
                for raw_path in untracked.split(b"\0"):
                    if raw_path:
                        path = raw_path.decode()
                        tar.add(ROOT / path, arcname=path, recursive=False)
            with archive.open("rb") as stream:
                execute("tar", "-xf", "-", "-C", staged, stdin=stream)
        execute("sh", "-c", 'cat > "$1/.git/helixium-base"', "_", staged, input=(base + "\n").encode())
        execute("bash", "-ec", 'test ! -e "$2"; test ! -L "$2"; mv "$1" "$2"', "_", staged, workspace)
    finally:
        execute("rm", "-rf", staged, check=False)
    return base


def export_source(execute, workspace, name):
    base_file = f"{workspace}/.git/helixium-base"
    if not copied_base(execute, workspace):
        execute("test", "!", "-e", f"{workspace}/.git")
        print("No completed source copy to export")
        return None
    result = execute("bash", "-ec", r'''
        cd "$1"
        export_dir=$(mktemp -d /tmp/helixium-export.XXXXXX)
        trap 'rm -rf "$export_dir"' ERR
        export GIT_INDEX_FILE="$export_dir/index"
        git read-tree HEAD
        git add -A -- .
        git diff --cached --binary "$(cat "$2")" > "$export_dir/changes.patch"
        git bundle create "$export_dir/commits.bundle" HEAD
        cp "$2" "$export_dir/base.txt"
        rm "$GIT_INDEX_FILE"
        printf '%s' "$export_dir"
    ''', "_", workspace, base_file, stdout=subprocess.PIPE)
    source = result.stdout.decode().strip()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    destination = ROOT / ".sandbox/exports" / f"{name}-{stamp}"
    destination.mkdir(parents=True, exist_ok=False)
    try:
        for filename in ("changes.patch", "commits.bundle", "base.txt"):
            with (destination / filename).open("wb") as stream:
                execute("cat", f"{source}/{filename}", stdout=stream)
    finally:
        execute("rm", "-rf", source, check=False)
    print(f"Exported changes and commits to {destination}")
    return destination
