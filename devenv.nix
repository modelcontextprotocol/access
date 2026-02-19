{ pkgs, ... }:
{
  packages = [
    pkgs.google-cloud-sdk
    pkgs.nodejs_22
    pkgs.pulumi-bin
    pkgs.pulumiPackages.pulumi-nodejs
  ];
}
