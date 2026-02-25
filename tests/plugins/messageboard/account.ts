// tests/plugins/messageboard/account.ts
// Account type for the messageboard test plugin.

import type { BaseAccount } from "@bernays/server/views";
import type { ParticipantId } from "@bernays/server/core";

export interface MessageBoardAccount extends BaseAccount<"messageboard"> {
  readonly id: ParticipantId<"messageboard">;
}
