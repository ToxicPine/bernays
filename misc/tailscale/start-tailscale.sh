#!/bin/sh
set -e

echo "[tailscale] Starting tailscaled..."
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Wait for daemon to be ready
echo "[tailscale] Waiting for tailscaled socket..."
while [ ! -S /var/run/tailscale/tailscaled.sock ]; do
  sleep 0.5
done

echo "[tailscale] Authenticating..."

# Build tailscale up command
TS_ARGS="--authkey=${TAILSCALE_AUTHKEY}"
TS_ARGS="${TS_ARGS} --hostname=fly-${FLY_APP_NAME:-bernays}-${FLY_REGION:-unknown}"
TS_ARGS="${TS_ARGS} --accept-routes"

# Configure exit node if specified
if [ -n "${TAILSCALE_EXIT_NODE}" ]; then
  echo "[tailscale] Using exit node: ${TAILSCALE_EXIT_NODE}"
  TS_ARGS="${TS_ARGS} --exit-node=${TAILSCALE_EXIT_NODE}"
  TS_ARGS="${TS_ARGS} --exit-node-allow-lan-access"
fi

# Advertise as exit node if requested
if [ "${TAILSCALE_ADVERTISE_EXIT}" = "true" ]; then
  echo "[tailscale] Advertising as exit node"
  TS_ARGS="${TS_ARGS} --advertise-exit-node"
fi

# Run tailscale up
eval "tailscale up ${TS_ARGS}"

echo "[tailscale] Connected successfully"
tailscale status

# If we need to run a proxy server for SOCKS5 access
if [ "${TAILSCALE_SOCKS5_PROXY}" = "true" ]; then
  echo "[tailscale] Starting SOCKS5 proxy on port 1080..."
  # Tailscale includes a built-in SOCKS5 proxy when using userspace networking
  # For container networking, we may need an external tool
fi

# Keep container running and log status periodically
while true; do
  sleep 300
  echo "[tailscale] Status check:"
  tailscale status --json | head -20
done
