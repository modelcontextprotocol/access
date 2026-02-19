{ pkgs, ... }:
{
  packages = [
    pkgs.nodejs_22
    pkgs.pulumi-bin
    pkgs.pulumiPackages.pulumi-nodejs
  ];
}
