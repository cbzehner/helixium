# Helixium

Keyboard browsing with Helix-style modes. Build using `devenv shell -- npm
run build`, then load the browser-specific folder under `dist/`.
Development and testing use disposable VMs; see [testing](docs/testing.md).

| Browser | Development installation |
| --- | --- |
| Chrome | Open `chrome://extensions`, enable Developer mode, select Load unpacked, and choose `dist/chrome`. |
| Firefox | Open `about:debugging#/runtime/this-firefox`, select Load Temporary Add-on, and choose `dist/firefox/manifest.json`. |
| Safari | Enable developer features in Safari settings, then use Developer → Add Temporary Extension and choose `dist/safari`. |

Firefox and Safari development installations are temporary. Store signing
and distribution are separate from these local development builds.

Use `h j k l` to scroll, `g g` / `g e` to reach the start / end, `z` for
one view motion and `Z` for sticky view mode. Numeric prefixes repeat
motions. `v` extends text selections, and `y` copies selection or page URL.
`i` passes keys through until Escape. Input fields retain normal typing.

Browser adaptations: `f` / `F` show link hints for the current / a new
background tab. `g n` / `g p` switch tabs, Space b filters tabs, Space f
opens a URL, and Space c closes the current tab. Hints can focus embedded
frames; subsequent commands then operate within that frame. `/` / `?` search literal
text forward / backward; `n` / `N` repeat. Space ? shows help.

These mappings follow [Helix's keymap](https://docs.helix-editor.com/keymap.html)
where browsing has a corresponding action. Link hints replace character
finding; search uses literal browser text search, not Helix regex search.
Browser-reserved shortcuts may take precedence. Extensions cannot run on
browser settings pages, extension stores, or other restricted documents.

The extension has no remote services or telemetry. Tab access supports
the tab picker; clipboard write supports explicit yank commands. Content
scripts run on HTTP(S) pages. No page data is persisted.
