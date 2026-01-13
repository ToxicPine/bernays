{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];

      perSystem = { config, self', inputs', system, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          unstablePkgs = import inputs.nixpkgs-unstable {
            inherit system;
            config.allowUnfree = true;
          };

          playwrightModule = import ./flake-parts/playwright.nix;

        in
        {
          devShells.default = pkgs.mkShell ((playwrightModule { inherit pkgs; }) {
            nativeBuildInputs = [
              pkgs.just
              pkgs.flyctl
              pkgs.nodejs
              pkgs.esbuild
              pkgs.deno
              pkgs.csvlens
              pkgs.jq
              pkgs.deterministic-zip
              unstablePkgs.claude-code
            ];
            shellHook = ''
              export ESBUILD=${pkgs.esbuild}/bin/esbuild
              export ZIP_TOOL=${pkgs.deterministic-zip}/bin/deterministic-zip
              alias bernays=just
            '';
          });
        };
    };
}
