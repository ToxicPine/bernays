# Café Bernays, or: Claude Code for Bots

Vibecoding bot swarms to shill your products just got a lot easier! With
`bernays`, anyone can achieve Russia-grade mass persuasion with just fifteen
minutes and a few fingers.

**What The F&!k?** Yes, with `bernays`, you'll be flossing like Adin Ross!

- It's extremely easy to code a bot.
- It's already working on **Reddit and X**.
- They'll work together to shill for you.

**There's No Way This Works.** Oooh, fun, you should try it!

- You can use specialised agents to curate targets, which then tag-in other bots
  to message them.
- You can make it look like these bots are sending messages from your
  grandmother's computer.
- You can keep dozens of these running over months, and it will still be cheaper
  than Lemlist.

**OK, Fine, I'm Excited!** Yes, that's the spirit!

- You'll never catch them responding too quickly, forgetting things, etc, cuz
  they're tuff as funk.
- You'll sometimes lose a bot because it thinks it's wife got into a car crash,
  or some sh1t.
- You'll never have to find out what an API key actually is to do any of this.

You shouldn't have to know how it works, this is built for vibecoders, and
includes presets for Claude Code, Codex, Cursor, etc.

However, there are a few caveats:

- You should not use this to make it look like other people listen to your band,
  we know they don't.
- You should not use this to attempt inception against people that don't like
  you, that's weird.
- You should not suggest that the Russian state has already had this tool for
  many years.

## Installation

```bash
sh <(curl --proto '=https' --tlsv1.2 -L https://github.com/ToxicPine/bernays-installer/releases/latest/download/installer.sh) --daemon
```

## Usage

### "Beam Me Up, Scotty!"

```bash
bernays create not-evil
cd not-evil
bernays develop
claude "i need ten bots to defend my opinions in the comments of r/futurology" # frukin weirdos...
bernays deploy
```

### Erm... Excuse Me... Where's The Login for [X, Reddit, LinkedIn]?

You negotiate with Claude, and if you ask nicely, maybe she'll show you how. ☺️

### Seriously, How?

Your agent gets two things:

```typescript
// this could have been Reddit, or X:
const linkedIn = yield * LinkedIn; // inbox, threads, post, reply, update profile
const journal = yield * Journal; // memory that survives forever
```

Then, it does its voodoo:

```typescript
export const thomas = Effect.gen(function* () {
  const linkedIn = yield* LinkedIn;
  const journal = yield* Journal;

  const inbox = yield* platform.inbox;
  // you can look through this, look at a thread using `platform.threads`

  // aye ya put yer llm agent code here

  // get a little excited
  yield* linkedIn.execute({
    type: "reply",
    recipientId: "lil_boy",
    text: "hello, boy.",
  });

  // keep track of yer regrets
  yield* journal.record({
    kind: "did_something_stupid",
    threadCount: threads.length,
  });

  // loop over that nonsense here.

  yield* Effect.log("i'm done being stupid.");
});
```

**This is... useless?** Erm, no?

**Why is it like this?** We've effectively built an operating system for
synthetic humans, which wraps around your thomas agent to handle the tricky
parts. It works because of this thing called effect.website that you don't need
to know anything about. You can take a look at `architecture.md` if you like,
but it's not that interesting. With all of that crud in the codebase, here's
what we get:

#### Squad Tactics.

They live in a swarm, so they share a brain. You can literally just tell Claude
to "make Agent A wait for Agent B's signal," and the architecture is set up to
handle that level of collusion without turning into spaghetti code.

#### Show Me The Dojo.

You don't need burn real accounts testing your prompts. If you swap `LinkedIn`
for `LinkedInSim` in your config, your bots fight in a virtual sandbox, then get
rate-limited by fake APIs, and practice their dunks before touching the real
internet.

#### Survival of the Fittest.

You can run 50 accounts with "Nice Guy" logic and 50 with "Unhinged Salesman"
logic to see who wins, swap strategies mid-campaign, or even let them evolve
based on feedback, all without interrupting the other bots.

#### Infinite Respawns.

Internet outage? Spaghetti code? It doesn't matter what crashes your server,
your bots will still wake up the next day, read their permanent journal, and
continue mid-sentence. They literally cannot forget what they were doing.

#### Fk The Ops.

Browser proxies, restarts, health checks, deployment... all of that is handled
for you. You type `bernays deploy` and your swarm goes live. You type
`bernays logs thomas` and see what Thomas is thinking.

#### VIBEABILITY.

This isn't a library you fight with. It's a template you clone and own. It's is
structured so Claude Code doesn't get confused. You can commands, add platforms,
break stuff, fix stuff... it's actually fun.

## Platforms

- **Reddit** — monitor subreddits, reply to threads, reply to DMs
- **LinkedIn** — DMs, connection requests, profile engagement
- **X** — tweets, replies, quote tweets, follows

You can vibecode more integrations via the `plugins` folder.

---

go make some friends.
