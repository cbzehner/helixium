# Browser verification

Project dependencies come from `devenv.nix`, `devenv.lock`, and
`package-lock.json`. Build and run tests inside the guests. Tests load the
packaged extension in Chromium, Firefox, Chrome, and Safari; the additional
Linux WebKit check exercises only the content script and is labeled as such.

## Linux microVM

This follows Swimfrancisco's standalone Docker Sandboxes (`sbx`) workflow.
Install standalone sbx 0.42.1 or later, run `sbx login`, and initialize its
network policy with `sbx policy init balanced` if this host has no policy.
No Docker Desktop or host Docker Engine is required.

```sh
just sandbox helixium codex
just sandbox-exec helixium devenv shell -- just check
just sandbox-exec helixium devenv shell -- just test-browser
just sandbox-exec helixium devenv up
```

The launcher copies Git history, tracked edits, and non-ignored new files.
It mounts no host directories and forwards no application credentials.
sbx supplies its own agent authentication. Nix and browser profiles belong
to the guest. The network policy permits package downloads; other external
sites may require explicit per-sandbox rules.

Keep a foreground sbx session connected while using the desktop. Discover
ports with `sbx ports helixium` after each restart. The browser port serves
`/vnc.html?autoconnect=1&resize=scale`; the fixture is at guest localhost:8787.
Both forwarded host ports bind to loopback. The private desktop loads the
extension; its CDP endpoint at 127.0.0.1:9222 stays inside the guest.

Use the default sandbox template for bootstrap validation. A template made
for another project can retain that project's startup services.

## macOS VM: Chrome and Safari

Linux WebKit is not Safari; ARM Linux Chromium is not branded Chrome.
Use a disposable Tart macOS guest for those checks. Install Tart 2.36.0
from its release archive or put `tart` on PATH. `TART` may point at
a specific executable. The fallback local path is
`.sandbox/tools/tart.app/Contents/MacOS/tart`.

```sh
just macos-create helixium-safari
just macos-start helixium-safari
# In another terminal, after the guest boots:
just macos-seed helixium-safari
just macos-exec helixium-safari devenv shell -- just check
just macos-exec helixium-safari devenv shell -- just test-chrome
just macos-exec helixium-safari devenv shell -- just test-safari
```

The macOS guest receives a copied Git checkout using the same source/export
code as sbx. It has no shared folders, audio, or host clipboard. Tart's guest
agent carries commands and source bytes; no host SSH key is forwarded.
The initial base image uses its public `admin` account. Don't use it for
personal website logins. Nix and browser tooling are installed inside it.
SafariDriver automation is enabled only in that guest.

Chrome is installed by the locked Playwright CLI. The test uses Chrome's
DevTools extension installer. Firefox uses `webExtension.install` through
WebDriver BiDi. Safari uses its native SafariDriver and BiDi extension
installer. The tests never substitute injected content scripts when an
installed-extension test fails.

For interactive Safari development, Safari Settings → Advanced → Show
features for web developers enables the Developer tab. Add Temporary
Extension there and choose `dist/safari`. Temporary extensions are removed
when Safari quits. Distribution through the App Store requires Apple's
packaging/signing flow; it is separate from this development build.

## Evidence and cleanup

Results and screenshots are written inside each guest's `test-results/`.
Each JSON result identifies the browser version and whether the extension
was installed. Preserve the artifacts before removing a guest.

```sh
just sandbox-export helixium
just sandbox-remove helixium
just macos-export helixium-safari
just macos-remove helixium-safari
```

Keep the macOS guest running for export/removal. Exports under
`.sandbox/exports/` contain a cumulative binary patch against the original
host HEAD, a Git bundle preserving guest commits, and the base commit ID.
The export uses a temporary Git index and leaves the guest index unchanged.
Ignored files, dependencies, and browser profiles are excluded. Review
`changes.patch` and use `git apply --check` before applying it to a host
checkout that may have changed since import. Removal exports first and
preserves those host artifacts.

For sandbox changes, validate a fresh default-template guest, tests,
restart, loopback ports, lack of host mounts and forwarded SSH agent,
export of commits/deletions/new files, patch application to the recorded
base, preservation of the guest index, and removal.

Validation is in progress. The final browser matrix will be recorded here
once the native Chrome and Safari checks finish.

References: [Swimfrancisco-style sbx setup](https://docs.docker.com/ai/sandboxes/install/),
[Tart](https://tart.run/quick-start/),
[Chrome extension installation protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/),
[Firefox extension installation](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html),
[Safari extension development](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).
