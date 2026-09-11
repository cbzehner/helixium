# Helixium

Keyboard browsing with Helix-style modes for Chrome, Firefox, and Safari.

## Install

Requires Git, [Nix](https://nixos.org/download/), and
[devenv](https://devenv.sh/getting-started/). Build from source:

```sh
git clone https://github.com/cbzehner/helixium.git
cd helixium
devenv shell -- npm run build
```

Load the matching folder below; keep this checkout in place.

| Browser | Development installation |
| --- | --- |
| Chrome | Open `chrome://extensions`, enable Developer mode, select Load unpacked, and choose `dist/chrome`. |
| Firefox | Open `about:debugging#/runtime/this-firefox`, select Load Temporary Add-on, and choose `dist/firefox/manifest.json`. |
| Safari | Settings → Advanced → Show features for web developers; then Developer → Add Temporary Extension (authenticate when prompted) → `dist/safari`. Enable Helixium under Extensions and allow access to the websites you want to control. |

Reload existing tabs after installation. Firefox and Safari remove temporary
extensions when they quit; Chrome keeps its unpacked installation. These are
development builds, with no signed store package.

## Use

Press `Space`, `g`, `z`, or `Z` to see the available next keys. Keep typing
or click an option; Escape dismisses the menu. In `Space ?`, type to filter
commands, use ↑ / ↓ to browse, and Enter to run the selected command.

`h j k l` scroll; `g g` / `g e` go to the top / bottom. Counts repeat
motions; `z` applies one view motion, `Z` stays in view mode. `v` extends
selections; `y` copies the selection or page URL.
Copying requires a secure page (HTTPS or localhost), following the browser's
[Clipboard API restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard).
`i` passes keys through until Escape. Input fields retain normal typing.

`f` / `F` show hints for the current / a new background tab. Hints also
focus controls and frames. Hints do not enter shadow roots.
`g n` / `g p` switch tabs; Space b filters tabs,
Space f opens a URL, Space c closes a tab. `/` / `?` search forward /
backward; `n` / `N` repeat. Space ? searches all commands.

Adapted from [Helix's keymap](https://docs.helix-editor.com/keymap.html):
link hints replace character finding; search is literal, not regex.
Browser-reserved shortcuts may take precedence. Extensions cannot run on
browser settings pages, extension stores, or other restricted documents.

The extension has no remote services or telemetry. Tab access supports
the tab picker; clipboard write supports explicit yank commands. Content
scripts run on HTTP(S) pages. No page data is persisted.

## Develop

`src/` contains the keymap, page controls, and background tab actions;
`scripts/` builds the extension and manages VMs; `tests/` holds the checks.
Use disposable VMs for development and tests: [setup, commands, and
verification](docs/testing.md).

After source changes, rebuild, reload the extension in the browser's extension
settings, and reload affected tabs. Automated browser tests rebuild for you;
Safari requires manually reloading the current build before testing.
