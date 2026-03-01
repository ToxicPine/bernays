{ pkgs }: config: let
  browsers = (builtins.fromJSON (builtins.readFile "${pkgs.playwright-driver}/browsers.json")).browsers;
  chromium-rev = (builtins.head (builtins.filter (x: x.name == "chromium") browsers)).revision;
  browserStateDir = "$HOME/.cache/social-automation/browser-state";
in config // {
  buildInputs = (config.buildInputs or []) ++ [
    pkgs.playwright
    pkgs.playwright-driver.browsers
  ];
  shellHook = (config.shellHook or "") + ''
    export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
    export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
    # Use headless_shell binary instead of full chromium - the regular chromium
    # crashes in headless mode on NixOS with crashpad "read out of range" errors.
    export PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH=${pkgs.playwright-driver.browsers}/chromium_headless_shell-${chromium-rev}/chrome-linux/headless_shell

    export BROWSER_STATE_DIR=${browserStateDir}

    mkdir -p "${browserStateDir}"
  '';
}