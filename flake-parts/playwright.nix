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
    export PLAYWRIGHT_LAUNCH_OPTIONS_EXECUTABLE_PATH=${pkgs.playwright-driver.browsers}/chromium-${chromium-rev}/chrome-linux/chrome
    
    export BROWSER_STATE_DIR=${browserStateDir}
    
    mkdir -p "${browserStateDir}"
  '';
}