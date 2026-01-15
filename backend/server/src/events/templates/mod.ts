// events/templates/mod.ts
// Event templates that platforms extend

export {
  AnchorMessageObservedBase,
  type AnchorMessageObservedBase as AnchorMessageObservedBaseType,
} from "./anchor-message.ts";

export {
  MessageObservedBase,
  type MessageObservedBase as MessageObservedBaseType,
} from "./message.ts";

export {
  AuthObservedBase,
  type AuthObservedBase as AuthObservedBaseType,
  authObservedBase,
  type AuthObservedFields,
  type AuthStatus,
  AuthStatusSchema,
} from "./auth.ts";

export {
  RateLimitObservedBase,
  type RateLimitObservedBase as RateLimitObservedBaseType,
  rateLimitObservedBase,
  type RateLimitObservedFields,
} from "./rate-limit.ts";
