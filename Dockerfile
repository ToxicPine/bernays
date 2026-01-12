FROM denoland/deno:2.6.0

WORKDIR /app

# Copy workspace configuration
COPY deno.json deno.lock ./

# Copy all workspace members
COPY backend ./backend
COPY plugins ./plugins
COPY agents ./agents
COPY tests ./tests
COPY scripts ./scripts

# Cache dependencies
RUN deno cache agents/src/main.ts
RUN deno cache scripts/**/*.ts

# Default command (can be overridden)
CMD ["deno", "run", "--allow-all", "agents/src/main.ts"]
