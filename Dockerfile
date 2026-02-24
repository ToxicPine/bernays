FROM denoland/deno:2.6.4

WORKDIR /app

# Copy workspace configuration
COPY deno.json deno.lock ./

# Copy all workspace members
COPY server ./server
COPY plugins ./plugins
COPY agents ./agents
COPY api ./api
COPY tests ./tests

# Cache dependencies
RUN deno cache agents/src/main.ts
RUN deno cache api/src/main.ts

# Default command (can be overridden by process groups)
CMD ["deno", "run", "--allow-all", "api/src/main.ts"]
