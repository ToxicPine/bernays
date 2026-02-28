// plugins/linkedin/sync.ts
// LinkedIn per-account sync fiber — background observation logic
//
// Periodically observes private LinkedIn state via CDP and emits events
// through injection. The sockpuppet never calls or sees this — it just
// reads the views that the fiber keeps current.

import { Effect, Schedule } from "effect";
import type { BrowserPoolService } from "@bernays/server/browsers";
import type { Injector } from "@bernays/server/projections";
import type { LinkedInAccount } from "./account.ts";
import type { LinkedInEvent } from "./schemas.ts";

// =============================================================================
// Sync Fiber Factory
// =============================================================================

/**
 * Create a per-account sync fiber that observes LinkedIn state.
 *
 * Observation tasks and frequencies (from Waalaxy internals):
 * - Auth check: every cycle (2 min)
 * - Inbox sync: every cycle (2 min)
 * - Profile viewing mode: once on startup
 * - Connection status: every 30th cycle (~60 min)
 * - Hot invitation check: every cycle for 30 min after send
 *
 * The sync fiber emits events through injection. The projection fiber
 * (in makePlatformLayer) folds them into the Ref<PluginState>.
 */
export const makeLinkedInSync = (
  _pool: BrowserPoolService,
  _account: LinkedInAccount,
  _injection: Injector<LinkedInEvent>,
): Effect.Effect<never> =>
  Effect.gen(function* () {
    let _cycle = 0;

    yield* Effect.repeat(
      Effect.gen(function* () {
        _cycle++;

        // TODO: 1. Auth check — read li_at cookie via CDP Network.getCookies
        //       Check for /checkpoint/challenge/ redirects
        //       Emit AuthObserved event

        // TODO: 2. Inbox sync — fetch conversations via Voyager API
        //       GET /voyager/api/voyagerMessagingDashMessengerConversations
        //       Emit AnchorMessageObserved / MessageObserved events
        //       Track reply directionality (senderId !== account.id)
        //       Emit ConversationsSynced

        // TODO: 3. Connection status (every 30 cycles or hot invitations)
        //       Check pending invitations against connections API
        //       Emit ConnectionAccepted / ConnectionRejected / ConnectionStatusUnknown

        yield* Effect.logDebug(`LinkedIn sync cycle ${_cycle}`);
      }).pipe(
        Effect.catchAll((err) =>
          Effect.logWarning(`LinkedIn sync error: ${err}`)
        ),
      ),
      Schedule.spaced("2 minutes").pipe(Schedule.jittered),
    );

    // Never returns — runs until scope is closed
    return yield* Effect.never;
  });
