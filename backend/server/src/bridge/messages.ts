// src/bridge/messages.ts
// Bridge message types for Playwright communication
import { z } from "@zod/zod";

export const BridgeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const BridgeMessageSchema = z.object({
  v: z.literal(1),
  type: z.enum(["request", "response", "event"]),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.unknown().optional(),
  error: BridgeErrorSchema.optional(),
});

export type BridgeError = z.infer<typeof BridgeErrorSchema>;
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

export interface BridgeRequest<TPayload = unknown> {
  readonly v: 1;
  readonly type: "request";
  readonly requestId: string;
  readonly correlationId?: string;
  readonly payload: TPayload;
  readonly error?: undefined;
}

export interface BridgeResponse<TPayload = unknown> {
  readonly v: 1;
  readonly type: "response";
  readonly requestId: string;
  readonly correlationId?: string;
  readonly payload?: TPayload;
  readonly error?: BridgeError;
}

export interface BridgeEvent<TPayload = unknown> {
  readonly v: 1;
  readonly type: "event";
  readonly requestId?: undefined;
  readonly correlationId: string;
  readonly payload: TPayload;
  readonly error?: undefined;
}
