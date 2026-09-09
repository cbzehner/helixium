"""Copy and export a Git workspace through a guest command transport."""

from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args, **kwargs):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, **kwargs)


def copy_source(execute, workspace, base_file):
    execute("test", "!", "-e", f"{workspace}/.git")
    execute("mkdir", "-p", workspace)
    base = git("rev-parse", "HEAD", stdout=subprocess.PIPE).stdout.decode().strip()
    patch = git("diff", "--binary", "--no-ext-diff", "HEAD", stdout=subprocess.PIPE).stdout
    untracked = git("ls-files", "--others", "--exclude-standard", "-z", stdout=subprocess.PIPE).stdout
    with tempfile.TemporaryDirectory(prefix="helixium-source-") as temporary:
        bundle = Path(temporary) / "source.bundle"
        git("bundle", "create", str(bundle), "HEAD")
        with bundle.open("rb") as stream:
            execute("sh", "-c", "cat > /tmp/helixium-source.bundle", stdin=stream)
        execute("bash", "-ec", '''
            cd "$1"
            git init -b main
            git fetch /tmp/helixium-source.bundle HEAD
            git reset --hard FETCH_HEAD
            rm /tmp/helixium-source.bundle
        ''', "_", workspace)
        if patch:
            execute("git", "-C", workspace, "apply", "--binary", "--whitespace=nowarn", "-", input=patch)
        archive = Path(temporary) / "untracked.tar"
        with tarfile.open(archive, "w") as tar:
            for raw_path in untracked.split(b"\0"):
                if raw_path:
                    path = raw_path.decode()
                    tar.add(ROOT / path, arcname=path, recursive=False)
        with archive.open("rb") as stream:
            execute("tar", "-xf", "-", "-C", workspace, stdin=stream)
    execute("sh", "-c", 'cat > "$1"', "_", base_file, input=(base + "\n").encode())
    return base


def export_source(execute, workspace, base_file, name):
    result = execute("bash", "-ec", r'''
        cd "$1"
        export_dir=$(mktemp -d /tmp/helixium-export.XXXXXX)
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
    for filename in ("changes.patch", "commits.bundle", "base.txt"):
        with (destination / filename).open("wb") as stream:
            execute("cat", f"{source}/{filename}", stdout=stream)
    print(f"Exported changes and commits to {destination}")
    return destination
