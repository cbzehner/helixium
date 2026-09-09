# Browser verification

Project dependencies come from `devenv.nix`, `devenv.lock`, and
`package-lock.json`. Build and run tests inside the guests. Automated tests load the
packaged extension in Chromium, Firefox, and Chrome; the additional
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

The launcher copies Git history, tracked edits, and non-ignored new files
into an empty destination. It stages the checkout before publishing it.
If setup is interrupted, run `python3 scripts/sandbox.py seed helixium`
again. Completed source copies are reused, preserving guest edits; dependency
installation is safe to retry. Ownership is recorded before resource creation
so `sandbox-remove` can also clean up a failed initial setup.
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
# Load the temporary Safari extension as described below first.
just macos-exec helixium-safari devenv shell -- just test-safari
```

The macOS guest receives a copied Git checkout using the same source/export
code as sbx. Retry interrupted setup with `just macos-seed helixium-safari`;
the completed checkout and guest edits are retained. It has no shared folders, audio, or host clipboard. Tart's guest
agent carries commands and source bytes; no host SSH key is forwarded.
The initial base image uses its public `admin` account. Don't use it for
personal website logins. Nix and browser tooling are installed inside it.
Safari tests send keyboard and mouse input through the guest’s loopback VNC
server. The Python VNC dependency is managed by devenv.

Only Chrome is downloaded on macOS; Safari ships in the pinned guest image.
Chrome is installed by the locked Playwright CLI. The test uses Chrome's
DevTools extension installer. Firefox uses `webExtension.install` through
WebDriver BiDi. Safari 26.6.2 exposes BiDi only with its experimental capability, and
rejects `webExtension.install` because that domain is unavailable. Safari
extension verification therefore requires its normal browser profile and
temporary-extension UI. An injected content-script check does not verify
an installed Safari extension.

For interactive Safari development, Safari Settings → Advanced → Show
features for web developers enables the Developer tab. Add Temporary
Extension there and choose `dist/safari`. Temporary extensions are removed
when Safari quits. Grant Helixium access to all websites in this disposable
guest so fixtures on random localhost ports can run. Keep the guest desktop
unlocked and Safari in front while running `just test-safari`.

The Safari runner observes fixture DOM state through a polling bridge served
only by the test process. It does not inject the extension or send synthetic
input for extension commands. The separate synthetic-event rejection test
intentionally uses untrusted DOM events. Screenshots and browser metadata
come from the same test run. VNC credentials default to the disposable base
image's public account; `VNC_USER` and `VNC_PASSWORD` can override them.

Chrome/Firefox browser tests rebuild automatically into clean artifact
directories. Safari tests first verify that `dist/safari` matches the current
source, then compare fingerprints from the running content and background
scripts with that build. After a source change, build and reload Safari's
temporary extension before testing. A stale or mixed installation fails
verification rather than inheriting a result from an older build.

Distribution through the App Store requires Apple's
packaging/signing flow; it is separate from this development build.

## Evidence and cleanup

Results and screenshots are written inside each guest's `test-results/`.
Each JSON result identifies the browser version, installed build fingerprint,
source commit, and a digest of uncommitted changes. WebKit reports only the
injected content-script artifact; it does not install an extension. Preserve the artifacts before removing a guest.

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

Verified on September 9, 2026:

| Browser | Version | Verification | Result |
| --- | --- | --- | --- |
| Chrome (macOS) | 153.0.8010.37 | Installed extension, 20 checks | [Passed](verification/chrome.json) |
| Firefox (Linux) | 151.0 | Installed extension, 20 checks | [Passed](verification/linux.json) |
| Safari (macOS) | 26.6.2 | Installed temporary extension, 13 grouped checks | [Passed](verification/safari.json) |
| Chromium (Linux) | 149.0.7827.0 | Installed extension, 20 checks | [Passed](verification/linux.json) |
| WebKit (Linux) | 26.5 | Content script only, 14 checks | [Passed](verification/linux.json) |

The suites cover counts and scrolling, Helix prefixes, editable controls,
insert mode, synthetic-event rejection, link and control hints (including
multi-character labels), same- and cross-origin frames, early page handlers,
search, selection, and nested scrolling. Installed-extension suites also
exercise background tabs, the closed-shadow tab picker, tab cycling/closing,
URL validation, and clipboard copying. The check command also runs 12
JavaScript tests for keymaps, background actions, builds, and VNC, plus six
Python tests for workspace copying and lifecycle recovery.
This is fixture-based development verification, not an exhaustive audit of
arbitrary websites or signed store packages.

Sandbox lifecycle evidence: [Linux](verification/linux-sandbox.json) and
[macOS](verification/macos-sandbox.json). Browser reports include artifact hashes and loaded build fingerprints; Safari
installation and interaction screenshots are alongside them. A separate
[stale Safari build check](verification/safari-build-mismatch.json) confirms
that the runner rejects an outdated installation before functional tests.

References: [Swimfrancisco-style sbx setup](https://docs.docker.com/ai/sandboxes/install/),
[Tart](https://tart.run/quick-start/),
[Chrome extension installation protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/),
[Firefox extension installation](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html),
[Safari extension development](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).
