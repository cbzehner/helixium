{ pkgs, ... }: {
  packages = [ pkgs.nodejs_22 pkgs.just pkgs.git pkgs.python3 ];
  scripts.check.exec = "npm test && npm run build";
  enterTest = "check";
}
