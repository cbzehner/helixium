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
IMAGE = "ghcr.io/cirruslabs/macos-tahoe-base@sha256:1b093499716409d29e8b5336844528e1cae375db97d2ad8e5aeff78cf0da201e"


def run(*args, **kwargs):
    kwargs.setdefault("check", True)
    return subprocess.run(args, cwd=ROOT, **kwargs)


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
        existing = json.loads(run(TART, "list", "--format", "json", stdout=subprocess.PIPE).stdout)
        if any(vm["Name"] == args.name for vm in existing):
            parser.error("sandbox already exists; refusing to take ownership")
        state.parent.mkdir(exist_ok=True)
        configuration = {"name": args.name, "image": args.image, "phase": "creating"}
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        run(TART, "clone", args.image, args.name)
        configuration["phase"] = "created"
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        run(TART, "set", args.name, "--cpu", "4", "--memory", "6144")
        print(f"Created. Run macos-sandbox.py start {args.name} in one terminal, then seed in another.")
    elif args.action == "start":
        run(TART, "run", "--no-clipboard", "--no-audio", args.name)
    elif args.action == "seed":
        configuration = json.loads(state.read_text())
        configuration["phase"] = "copying"
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        base = copy_source(remote, WORKSPACE)
        configuration.update(base=base, phase="copied")
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        remote("bash", f"{WORKSPACE}/sandbox/macos-install.sh")
        configuration["phase"] = "ready"
        state.write_text(json.dumps(configuration, indent=2) + "\n")
    elif args.action == "exec":
        command = command[1:] if command[:1] == ["--"] else command
        if not command:
            parser.error("exec requires a command after --")
        remote("bash", "-lc", 'cd "$1"; shift; exec "$@"', "_", WORKSPACE, *command)
    elif args.action == "export":
        export_source(remote, WORKSPACE, args.name)
    elif args.action == "remove":
        if not state.exists():
            parser.error("refusing removal without this project's sandbox state")
        existing = json.loads(run(TART, "list", "--format", "json", stdout=subprocess.PIPE).stdout)
        vm = next((vm for vm in existing if vm["Name"] == args.name), None)
        if vm:
            if vm["Running"]:
                export_source(remote, WORKSPACE, args.name)
                run(TART, "stop", args.name)
            elif json.loads(state.read_text())["phase"] not in ["creating", "created"]:
                parser.error("start the sandbox before removal so guest changes can be exported")
            run(TART, "delete", args.name)
        state.unlink()


if __name__ == "__main__":
    main()
