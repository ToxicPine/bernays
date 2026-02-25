// tests/plugins/messageboard/mod.ts
// PlatformDefinition, tags, and layers for the messageboard test plugin.

import { Context, Effect, Layer } from "effect";
import type { Page } from "playwright";
import {
  makeInjectionLayer,
  makeInjectorTag,
  makeProjectionLayer,
  makeProjectionTag,
  type Injector,
} from "@bernays/server/projections";
import { makePlatformLayer } from "@bernays/server/runtime";
import type { PlatformDefinition, PlatformService } from "@bernays/server/platforms";
import {
  CanonicalId,
  CorrelationId,
  EventId,
  ParticipantId,
  hash,
} from "@bernays/server/core";
import type { BaseBoundBrowser } from "@bernays/server/views";

import {
  MESSAGEBOARD_SCOPE,
  MessageBoardAnchorSchema,
  MessageBoardEventSchema,
  type MessageBoardEvent,
  type MessageBoardScope,
} from "./schemas.ts";
import {
  messageBoardBehavior,
  type MessageBoardInbox,
  type MessageBoardPluginState,
  type MessageBoardThread,
} from "./behavior.ts";
import type { MessageBoardAccount } from "./account.ts";

// =============================================================================
// Injection / Projection tags & layers
// =============================================================================

export const MessageBoardInjection = makeInjectorTag<MessageBoardEvent>(
  "messageboard/Injection",
);

export const MessageBoardProjection = makeProjectionTag<MessageBoardEvent>(
  "messageboard/Projection",
);

export const MessageBoardInjectionLive = makeInjectionLayer(
  MessageBoardInjection,
  MESSAGEBOARD_SCOPE,
  MessageBoardEventSchema,
);

export const MessageBoardProjectionLive = makeProjectionLayer(
  MessageBoardProjection,
  MESSAGEBOARD_SCOPE,
  MessageBoardEventSchema,
);

// =============================================================================
// Platform definition
// =============================================================================

export const messageBoardPlatform: PlatformDefinition<
  MessageBoardScope,
  "messageboard",
  MessageBoardEvent,
  ReturnType<typeof MessageBoardAnchorSchema.parse>,
  MessageBoardThread,
  MessageBoardInbox,
  MessageBoardAccount,
  BaseBoundBrowser,
  never,
  MessageBoardPluginState
> = {
  scope: MESSAGEBOARD_SCOPE,
  identity: "messageboard",
  eventSchema: MessageBoardEventSchema,
  anchorSchema: MessageBoardAnchorSchema,
  behavior: messageBoardBehavior,
};

// =============================================================================
// Actions
// =============================================================================

const BOARD_URL = "https://board.test";
const BOARD_API_KEY = "test-key";

export type MessageBoardActionError =
  | { readonly code: "ReadFailed"; readonly message: string }
  | { readonly code: "PostFailed"; readonly message: string };

export interface MessageBoardActions {
  readonly readMessages: () => () => Effect.Effect<void, MessageBoardActionError>;
  readonly postMessage: () => (
    content: string,
  ) => Effect.Effect<
    { success: true; messageId: string },
    MessageBoardActionError
  >;
}

export interface MessageBoardActionDeps {
  readonly page: Page;
  readonly injector: Injector<MessageBoardEvent>;
  readonly account: MessageBoardAccount;
}

export const makeMessageBoardActions = (
  deps: MessageBoardActionDeps,
): MessageBoardActions => ({
  readMessages: () => () =>
    Effect.gen(function* () {
      const messages = yield* Effect.tryPromise({
        try: () =>
          deps.page.evaluate(
            async ({ url, key }: { url: string; key: string }) => {
              const res = await fetch(`${url}/messages`, {
                headers: { "Authorization": `Bearer ${key}` },
              });
              return res.json() as Promise<
                Array<{
                  id: string;
                  author: string;
                  content: string;
                  timestamp: string;
                }>
              >;
            },
            { url: BOARD_URL, key: BOARD_API_KEY },
          ),
        catch: (err) => ({
          code: "ReadFailed" as const,
          message: String(err),
        }),
      });

      yield* Effect.forEach(
        messages,
        (msg) =>
          Effect.gen(function* () {
            const canonicalId = yield* Effect.promise(() =>
              hash("messageboard", msg.author, msg.content, msg.timestamp).then(
                CanonicalId,
              )
            );
            yield* deps.injector.append({
              kind: "anchor",
              scope: MESSAGEBOARD_SCOPE,
              type: "AnchorMessageObserved",
              eventId: EventId(crypto.randomUUID()),
              correlationId: CorrelationId(crypto.randomUUID()),
              timestamp: msg.timestamp,
              canonicalId,
              senderId: ParticipantId("messageboard", msg.author),
              content: msg.content,
              anchor: { boardMessageId: msg.id },
            }).pipe(
              Effect.mapError((e) => ({
                code: "ReadFailed" as const,
                message: e.message,
              })),
            );
          }),
        { discard: true },
      );
    }),

  postMessage: () => (content: string) =>
    Effect.gen(function* () {
      const authorId = deps.account.id.split(":")[1] ?? deps.account.id;

      const result = yield* Effect.tryPromise({
        try: () =>
          deps.page.evaluate(
            async (
              {
                url,
                key,
                body,
              }: {
                url: string;
                key: string;
                body: { author: string; content: string };
              },
            ) => {
              const res = await fetch(`${url}/messages`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${key}`,
                },
                body: JSON.stringify(body),
              });
              return res.json() as Promise<{ id: string; timestamp: string }>;
            },
            {
              url: BOARD_URL,
              key: BOARD_API_KEY,
              body: { author: authorId, content },
            },
          ),
        catch: (err) => ({
          code: "PostFailed" as const,
          message: String(err),
        }),
      });

      const canonicalId = yield* Effect.promise(() =>
        hash("messageboard", authorId, content, result.timestamp).then(
          CanonicalId,
        )
      );

      yield* deps.injector.append({
        scope: MESSAGEBOARD_SCOPE,
        type: "MessageSent",
        eventId: EventId(crypto.randomUUID()),
        correlationId: CorrelationId(crypto.randomUUID()),
        timestamp: result.timestamp,
        canonicalId,
        senderId: deps.account.id,
        content,
        boardMessageId: result.id,
      }).pipe(
        Effect.mapError((e) => ({
          code: "PostFailed" as const,
          message: e.message,
        })),
      );

      return { success: true as const, messageId: result.id };
    }),
});

// =============================================================================
// Platform tag & layer
// =============================================================================

export class MessageBoardPlatform extends Context.Tag(
  "messageboard/Platform",
)<
  MessageBoardPlatform,
  PlatformService<
    MessageBoardScope,
    "messageboard",
    MessageBoardActions,
    MessageBoardInbox,
    MessageBoardThread,
    BaseBoundBrowser,
    never
  >
>() {}

export const makeMessageBoardPlatformLayer = (
  account: MessageBoardAccount,
  actions: MessageBoardActions,
) =>
  makePlatformLayer(MessageBoardPlatform, MessageBoardProjection, {
    platform: messageBoardPlatform,
    account,
    actions,
  });

// Re-exports
export {
  MESSAGEBOARD_SCOPE,
  type MessageBoardEvent,
  MessageBoardEventSchema,
  type MessageBoardScope,
} from "./schemas.ts";
export {
  messageBoardBehavior,
  type MessageBoardPluginState,
} from "./behavior.ts";
export type { MessageBoardAccount } from "./account.ts";
