#!/usr/bin/env python3
"""Disposable macOS browser testing with Tart and a copied Git checkout."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from workspace import ROOT, copy_source, export_source

TART = os.environ.get("TART") or shutil.which("tart") or str(ROOT / ".sandbox/tools/tart.app/Contents/MacOS/tart")
WORKSPACE = "/Users/admin/workspace"
BASE_FILE = "/Users/admin/.helixium-sandbox-base"
IMAGE = "ghcr.io/cirruslabs/macos-tahoe-base:latest"


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def execute(name, *args, **kwargs):
    interactive = ["-i"] if "input" in kwargs or "stdin" in kwargs else []
    return run(TART, "exec", *interactive, name, *args, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "start", "seed", "exec", "export", "remove"])
    parser.add_argument("name", nargs="?", default="helixium-safari")
    parser.add_argument("--image", default=IMAGE)
    args, command = parser.parse_known_args()
    if not re.fullmatch(r"helixium-[a-z0-9.-]+", args.name):
        parser.error("macOS sandbox names must start with helixium-")
    if command and args.action != "exec":
        parser.error("unexpected arguments")
    remote = lambda *command, **kwargs: execute(args.name, *command, **kwargs)
    state = ROOT / ".sandbox" / f"{args.name}.json"
    if args.action == "create":
        if state.exists():
            parser.error("sandbox already has local state")
        run(TART, "clone", args.image, args.name)
        run(TART, "set", args.name, "--cpu", "4", "--memory", "6144")
        print(f"Created. Run macos-sandbox.py start {args.name} in one terminal, then seed in another.")
    elif args.action == "start":
        run(TART, "run", "--no-clipboard", "--no-audio", args.name)
    elif args.action == "seed":
        base = copy_source(remote, WORKSPACE, BASE_FILE)
        state.parent.mkdir(exist_ok=True)
        state.write_text(json.dumps({"name": args.name, "base": base, "image": args.image}, indent=2) + "\n")
        remote("bash", f"{WORKSPACE}/sandbox/macos-install.sh")
    elif args.action == "exec":
        command = command[1:] if command[:1] == ["--"] else command
        if not command:
            parser.error("exec requires a command after --")
        remote("bash", "-lc", 'cd "$1"; shift; exec "$@"', "_", WORKSPACE, *command)
    elif args.action == "export":
        export_source(remote, WORKSPACE, BASE_FILE, args.name)
    elif args.action == "remove":
        if not state.exists():
            parser.error("refusing removal without this project's sandbox state")
        export_source(remote, WORKSPACE, BASE_FILE, args.name)
        run(TART, "stop", args.name)
        run(TART, "delete", args.name)
        state.unlink()


if __name__ == "__main__":
    main()
