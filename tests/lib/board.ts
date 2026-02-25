// tests/lib/board.ts
// In-process JSON message board for E2E tests.
// A pure Request → Response handler — no server, no port, no subprocess.

export interface BoardMessage {
  readonly id: string;
  readonly author: string;
  readonly content: string;
  readonly timestamp: string;
}

export type BoardHandler = (request: Request) => Promise<Response>;

/**
 * Create a stateful in-process board handler.
 *
 * Returns a `Request → Response` function that implements a minimal
 * JSON message board API. The board state is an in-memory array scoped
 * to the returned handler — there is no shared global state.
 *
 * Endpoints:
 *   GET  /messages        → JSON array of all messages
 *   POST /messages        → Post a new message ({ author, content })
 *   DELETE /messages      → Clear all messages (for test reset)
 *
 * Auth: single header `Authorization: Bearer <apiKey>`. Returns 401 if
 * missing or wrong.
 */
export const createBoard = (apiKey: string): BoardHandler => {
  const messages: BoardMessage[] = [];

  return async (request: Request): Promise<Response> => {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${apiKey}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/messages" && request.method === "GET") {
      return Response.json(messages);
    }

    if (url.pathname === "/messages" && request.method === "POST") {
      const body = await request.json() as { author: string; content: string };
      const msg: BoardMessage = {
        id: crypto.randomUUID(),
        author: body.author,
        content: body.content,
        timestamp: new Date().toISOString(),
      };
      messages.push(msg);
      return Response.json(msg, { status: 201 });
    }

    if (url.pathname === "/messages" && request.method === "DELETE") {
      messages.length = 0;
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  };
};
