#!/bin/bash
# Setup script for running a Tailscale exit node on a local machine
# This allows Fly.io deployments to route through your residential IP
#
# Usage: ./setup-local-exit-node.sh [auth-key]
#
# If auth-key not provided, will prompt for it

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Tailscale Exit Node Setup ===${NC}"
echo ""

if [ -n "$1" ]; then
  TAILSCALE_AUTHKEY="$1"
elif [ -n "$TAILSCALE_AUTHKEY" ]; then
  echo "Using TAILSCALE_AUTHKEY from environment"
else
  echo -e "${YELLOW}Get an auth key from: https://login.tailscale.com/admin/settings/keys${NC}"
  echo "  - Reusable: Yes"
  echo "  - Ephemeral: No"
  echo "  - Tags: tag:proxy (optional)"
  echo ""
  read -p "Enter Tailscale auth key: " TAILSCALE_AUTHKEY
fi

if [ -z "$TAILSCALE_AUTHKEY" ]; then
  echo -e "${RED}Error: Auth key required${NC}"
  exit 1
fi

# Detect OS
OS="$(uname -s)"
case "${OS}" in
  Linux*)   PLATFORM=linux;;
  Darwin*)  PLATFORM=macos;;
  *)        PLATFORM=unknown;;
esac

echo "Detected platform: $PLATFORM"

if command -v docker &> /dev/null; then
  HAS_DOCKER=true
else
  HAS_DOCKER=false
fi

if [ "$PLATFORM" = "linux" ]; then
  echo ""
  echo "Choose installation method:"
  echo "  1) Native Tailscale (recommended for servers)"
  echo "  2) Docker container (recommended for desktops)"
  read -p "Selection [1]: " METHOD
  METHOD=${METHOD:-1}

  if [ "$METHOD" = "1" ]; then
    echo ""
    echo -e "${GREEN}Installing Tailscale natively...${NC}"

    if ! command -v tailscale &> /dev/null; then
      curl -fsSL https://tailscale.com/install.sh | sh
    fi

    echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
    echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
    sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

    sudo tailscale up --authkey="$TAILSCALE_AUTHKEY" --advertise-exit-node --hostname="home-proxy"

    echo ""
    echo -e "${GREEN}Done! Now approve the exit node at:${NC}"
    echo "  https://login.tailscale.com/admin/machines"
    echo ""
    echo "Look for 'home-proxy' and click the three dots > Edit route settings > Use as exit node"

  else
    echo ""
    echo -e "${GREEN}Setting up Docker container...${NC}"

    if [ "$HAS_DOCKER" = "false" ]; then
      echo -e "${RED}Docker not found. Please install Docker first.${NC}"
      exit 1
    fi

    docker run -d \
      --name tailscale-exit-node \
      --hostname home-proxy \
      -e TS_AUTHKEY="$TAILSCALE_AUTHKEY" \
      -e TS_EXTRA_ARGS="--advertise-exit-node --hostname=home-proxy" \
      -e TS_STATE_DIR=/var/lib/tailscale \
      -v tailscale-state:/var/lib/tailscale \
      -v /dev/net/tun:/dev/net/tun \
      --cap-add NET_ADMIN \
      --cap-add SYS_MODULE \
      --sysctl net.ipv4.ip_forward=1 \
      --sysctl net.ipv6.conf.all.forwarding=1 \
      --restart unless-stopped \
      tailscale/tailscale:latest

    echo ""
    echo -e "${GREEN}Container started! Now approve the exit node at:${NC}"
    echo "  https://login.tailscale.com/admin/machines"
  fi

elif [ "$PLATFORM" = "macos" ]; then
  echo ""
  echo -e "${GREEN}Setting up on macOS...${NC}"

  if ! command -v tailscale &> /dev/null; then
    echo "Installing Tailscale via Homebrew..."
    brew install tailscale
  fi

  echo ""
  echo -e "${YELLOW}macOS Setup Instructions:${NC}"
  echo ""
  echo "1. Install Tailscale from the Mac App Store or: brew install --cask tailscale"
  echo "2. Open Tailscale and sign in"
  echo "3. Click the Tailscale icon in menu bar"
  echo "4. Go to Preferences > Use as exit node (check this)"
  echo "5. Approve at: https://login.tailscale.com/admin/machines"
  echo ""
  echo "For CLI-only setup (requires root):"
  echo "  sudo tailscaled &"
  echo "  tailscale up --authkey=\"$TAILSCALE_AUTHKEY\" --advertise-exit-node --hostname=\"home-proxy\""

else
  echo -e "${RED}Unsupported platform: $OS${NC}"
  echo "Please install Tailscale manually: https://tailscale.com/download"
  exit 1
fi

echo ""
echo -e "${GREEN}=== Next Steps ===${NC}"
echo ""
echo "1. Approve the exit node in Tailscale admin console"
echo "2. In your Fly.io deployment, set:"
echo "   fly secrets set TAILSCALE_EXIT_NODE=home-proxy"
echo ""
echo "3. Verify with:"
echo "   tailscale status"
echo "   curl https://api.ipify.org  # Should show your home IP when routing through exit"
