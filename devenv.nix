{ pkgs, ... }: {
  packages = [ pkgs.nodejs_22 pkgs.just pkgs.git (pkgs.python3.withPackages (python: [ python.vncdo ])) ];
  scripts.check.exec = "just check";
  processes.fixture.exec = "node scripts/serve-fixture.mjs";
  enterTest = "check";
}
