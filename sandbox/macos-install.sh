#!/usr/bin/env bash
set -euo pipefail
# Executed only in the disposable macOS guest, as its admin user.
if [[ ! -x /nix/var/nix/profiles/default/bin/nix ]]; then
  curl -fsSL https://releases.nixos.org/nix/nix-2.34.7/install -o /tmp/install-nix
  sh /tmp/install-nix --daemon --yes
fi
sudo tee -a /etc/nix/nix.conf >/dev/null <<'NIX'
experimental-features = nix-command flakes
trusted-users = root admin
extra-substituters = https://devenv.cachix.org
extra-trusted-public-keys = devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw=
NIX
sudo launchctl kickstart -k system/org.nixos.nix-daemon
source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
if ! command -v devenv >/dev/null; then
  nix --extra-experimental-features 'nix-command flakes' profile add github:cachix/devenv/v2.2.2#devenv
fi
export PATH="$HOME/.nix-profile/bin:$PATH"
cd /Users/admin/workspace
devenv shell -- npm ci
devenv shell -- npm run build
devenv shell -- node node_modules/playwright-core/cli.js install chromium firefox chrome
# Changes only the guest's automation settings.
sudo /usr/bin/safaridriver --enable
