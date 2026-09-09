{ pkgs, ... }: {
  packages = [ pkgs.nodejs_22 pkgs.just pkgs.git (pkgs.python3.withPackages (python: [ python.vncdo ])) ];
  scripts.check.exec = "npm test && npm run build";
  processes.fixture.exec = "node scripts/serve-fixture.mjs";
  enterTest = "check";
}
