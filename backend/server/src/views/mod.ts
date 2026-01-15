// src/views/mod.ts
// View type definitions barrel exports

export {
  type BaseAccount,
  type BaseBoundBrowser,
  type BrowserBinding,
  BrowserBindingSchema,
  parseBrowserBindings,
} from "./browser.ts";

export { type BaseContact } from "./contact.ts";

export { type BaseInboxView } from "./inbox.ts";

export {
  type BaseThreadView,
  calculateUnreadCount,
  type MessageView,
  type Participant,
} from "./thread.ts";

export {
  buildThreadGraphs,
  findThreadRoot,
  type GraphMessage,
  type GraphNode,
  graphNodesToMessages,
  type GraphNodeView,
  type ThreadGraph,
} from "./graph.ts";

export { extractParticipants, toMessageViews } from "./behavior-utils.ts";
