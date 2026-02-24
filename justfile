# bernays justfile — aliased as `bernays` in the dev shell

# Enter the development environment
develop:
    nix develop

# Deploy the agent using ambit (use `claude "deploy my agent using ambit"` instead)
deploy:
    @echo "Use: claude \"deploy my agent using ambit\""
