FROM denoland/deno:2.6.0

WORKDIR /app

COPY deno.json deno.lock ./
COPY packages ./packages

RUN deno cache -r packages/commandline/src/main.ts