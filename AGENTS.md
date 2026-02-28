# Implementing a Sockpuppet

A sockpuppet is a program that pretends to be a human using an online account.
It wakes up when it wants, looks at its inbox, decides what to do, does it, and
writes down what it did. Then it goes back to sleep.

The runtime makes this feel exactly like that. The sockpuppet never thinks about
browsers, event stores, network calls, or crash recovery. It thinks about
conversations, people, and decisions.

## Setup

Before implementing a sockpuppet, load the `bernays` skill. If it isn't
installed, install it first:

```
npx skills add ToxicPine/ambit-bernays
```

## Mental Model

Think of a human at a laptop. They open LinkedIn and see their inbox already
loaded. They didn't fetch anything — the page was already there. They scan
threads, decide who to reply to, type a message, hit send. Maybe they jot a note
so they remember what they did. Then they close the laptop.

A sockpuppet does exactly this:

1. **Sit down** — yield the platform service from context
2. **Look at the screen** — read views that are already populated
3. **Decide** — apply whatever logic you want
4. **Act** — call an action (send a message, request a connection)
5. **Write it down** — record the decision in your journal
6. **Leave** — the process can stop at any point and restart safely

The sockpuppet controls *when* it looks and *how often*. It does not control
*how* data arrives.

## One Sockpuppet, One Person

A sockpuppet represents a single person — not a single account. One person
might have a LinkedIn and an X account, both operated by the same sockpuppet.
The sockpuppet yields multiple platform services and acts across them with one
journal and one identity.

Everything deployed together shares a briefing boundary and an API boundary.
This means sockpuppets in the same deployment can talk to each other through
briefings and share an event store. In practice, keep it close to one
sockpuppet per deployment. If two sockpuppets don't need to brief each other
or share infrastructure, they belong in separate deployments.

## What You See

A sockpuppet sees exactly three services. Nothing else.

- **Platform** — inbox, threads, contacts, browsers, and actions. Views are
  already current. Actions are things you *do* (send a message, request a
  connection).
- **Journal** — your notebook. Record decisions so you can pick up where you
  left off after a restart.
- **Briefing** — structured conversations with other agents. No HTTP — agents
  talk through a shared event log.

## What You Don't See

Everything behind the wall is handled for you:

- A background fiber keeps your views current by observing the real platform
- Actions automate a browser, observe the result, and record what happened
- Failures (auth challenges, rate limits) show up as browser status, not
  exceptions
- Restarts are safe — state rebuilds from an append-only event log
- Message deduplication is automatic via deterministic canonical IDs

## Reference Implementation

The `agents/` package is where sockpuppets are implemented:

- `agents/src/main.ts` — sockpuppet definition
- `agents/src/runtime.ts` — layer composition
- `agents/src/config.ts` — environment config
- `agents/src/stores.ts` — store initialization
