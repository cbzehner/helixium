#!/usr/bin/env python3
"""Create disposable sbx workspaces without mounting the host checkout."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
from workspace import copy_source, export_source

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = ROOT / "sandbox/sbxenv.yaml"
WORKSPACE = "/home/agent/workspace"
SBX = shutil.which("sbx") or str(Path.home() / ".local/bin/sbx")


def run(*args, **kwargs):
    kwargs.setdefault("check", True)
    return subprocess.run(args, cwd=ROOT, **kwargs)


def output(*args):
    return run(*args, stdout=subprocess.PIPE).stdout


def environment_args(name, agent, template):
    return [str(ENVIRONMENT), "--env-arg", f"name={name}",
            "--env-arg", f"agent={agent}", "--env-arg", f"template={template}"]


def execute(name, *args, **kwargs):
    interactive = ["-i"] if "input" in kwargs or "stdin" in kwargs else []
    return run(SBX, "exec", *interactive, "-w", "/home/agent", name, *args, **kwargs)


def seed(name):
    state = ROOT / ".sandbox" / f"{name}.json"
    configuration = json.loads(state.read_text())
    configuration["phase"] = "copying"
    state.write_text(json.dumps(configuration, indent=2) + "\n")
    base = copy_source(lambda *args, **kwargs: execute(name, *args, **kwargs),
                       WORKSPACE)
    configuration.update(base=base, phase="copied")
    state.write_text(json.dumps(configuration, indent=2) + "\n")
    run(SBX, "exec", "-w", WORKSPACE, name, "devenv", "shell", "--", "npm", "ci")
    run(SBX, "exec", "-w", WORKSPACE, name, "devenv", "shell", "--", "node",
        "node_modules/playwright-core/cli.js", "install", "--with-deps", "chromium", "firefox", "webkit")
    run(SBX, "exec", "-w", WORKSPACE, name, "devenv", "shell", "--", "npm", "run", "build")
    # Pin the project's Node for browser startup without concurrent devenv evaluation.
    run(SBX, "exec", "-w", WORKSPACE, name, "devenv", "shell", "--", "bash", "-ec", '''
        node_package=$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")
        nix-store --add-root /home/agent/.local/lib/helixium-sandbox/node-package \\
            --indirect --realise "$node_package"
    ''')
    run(SBX, "exec", name, "touch", "/home/agent/.helixium-sandbox-ready")
    run(SBX, "exec", name, "python3", "-c", '''
import json, socket, time, urllib.request
for attempt in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=1) as response:
            assert json.load(response)["webSocketDebuggerUrl"]
        with socket.create_connection(("127.0.0.1", 5900), timeout=1) as connection:
            assert connection.recv(12).startswith(b"RFB ")
        break
    except (OSError, ValueError, AssertionError, KeyError):
        time.sleep(1)
else:
    raise SystemExit("Browser desktop did not start; inspect /tmp/helixium-browser.log inside the sandbox")
''')
    configuration["phase"] = "ready"
    state.write_text(json.dumps(configuration, indent=2) + "\n")
    print(f"Ready: just sandbox-attach {name}")
    run(SBX, "ports", name)


def export(name):
    return export_source(lambda *args, **kwargs: execute(name, *args, **kwargs),
                         WORKSPACE, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["create", "seed", "attach", "exec", "export", "remove"])
    parser.add_argument("name", nargs="?", default="helixium")
    parser.add_argument("--agent", choices=["codex", "claude", "shell"], default="codex")
    parser.add_argument("--template")
    args, command = parser.parse_known_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+", args.name):
        parser.error("name must use lowercase letters, digits, periods, and hyphens")
    if command and args.action != "exec":
        parser.error(f"unexpected arguments: {' '.join(command)}")
    template = args.template or ""
    state = ROOT / ".sandbox" / f"{args.name}.json"
    if args.action == "create":
        if state.exists():
            parser.error("this sandbox already has local state; attach or remove it first")
        existing = json.loads(output(SBX, "ls", "--json"))["sandboxes"]
        if any(sandbox["name"] == args.name for sandbox in existing):
            parser.error("this sandbox already exists; attach to it instead")
        state.parent.mkdir(exist_ok=True)
        configuration = {"name": args.name, "agent": args.agent, "template": template, "phase": "creating"}
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        run(SBX, "env", "create", *environment_args(args.name, args.agent, template), "--auto-approve")
        configuration["phase"] = "created"
        state.write_text(json.dumps(configuration, indent=2) + "\n")
        seed(args.name)
    elif args.action == "seed":
        seed(args.name)
    elif args.action == "attach":
        run(SBX, "run", "--name", args.name)
    elif args.action == "exec":
        command = command[1:] if command[:1] == ["--"] else command
        if not command:
            parser.error("exec requires a command after --")
        run(SBX, "exec", "-w", WORKSPACE, args.name, *command)
    elif args.action == "export":
        export(args.name)
    elif args.action == "remove":
        configuration = json.loads(state.read_text())
        existing = json.loads(output(SBX, "ls", "--json"))["sandboxes"]
        if any(sandbox["name"] == args.name for sandbox in existing):
            if configuration["phase"] != "creating":
                export(args.name)
            run(SBX, "stop", args.name)
            run(SBX, "env", "rm", *environment_args(args.name, configuration["agent"],
                                                   configuration["template"]), "--force")
        state.unlink()


if __name__ == "__main__":
    main()
