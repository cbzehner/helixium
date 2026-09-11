#!/usr/bin/env bash
set -euo pipefail
# Executed only in the disposable macOS guest, as its admin user.
if [[ ! -x /nix/var/nix/profiles/default/bin/nix ]]; then
  curl -fsSL https://releases.nixos.org/nix/nix-2.34.7/install -o /tmp/install-nix
  echo "e9d447ce3d2ff62d7ff9cb6ef401de6fa8acb148839dd00f7271945d7b638b14  /tmp/install-nix" | shasum -a 256 -c -
  sh /tmp/install-nix --daemon --yes
fi
sudo tee /etc/nix/nix.conf >/dev/null <<'NIX'
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
devenv shell -- node node_modules/playwright-core/cli.js install chrome
