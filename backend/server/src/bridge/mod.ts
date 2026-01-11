// src/bridge/mod.ts
// Playwright bridge module

export {
  type BridgeError,
  BridgeErrorSchema,
  type BridgeEvent,
  type BridgeMessage,
  BridgeMessageSchema,
  type BridgeRequest,
  type BridgeResponse,
} from "./messages.ts";

export {
  type BridgeEventHandler,
  // Master bridge
  createMasterBridge,
  type MasterBridge,
} from "./master.ts";
