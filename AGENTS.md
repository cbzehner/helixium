# Working in Helixium

Use devenv for project dependencies. Run code and browser tests in the
project sandbox; see docs/testing.md. Keep browser profiles private to
the disposable guest. Do not treat WebKit as evidence of Safari extension
installation, or Chromium as evidence of branded Chrome testing.

Before delivery, run `just check` and `just test-browser` in devenv.
Record actual browser versions and whether the extension was installed.
