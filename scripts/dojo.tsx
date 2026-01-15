// scripts/dojo.tsx
// LinkedIn Dojo TUI - Browser-free testing environment for sockpuppets

import { useCallback, useEffect, useState } from "react";
import { Box, type Key, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Effect } from "effect";

import {
  FullHeightLayout,
  Header,
  isValidNumberKey,
  parseNumberKey,
  relativeTime,
  runApp,
  StatusBar,
  useListNavigation,
  useTerminalSize,
} from "$/lib/tui/mod.ts";

// Server imports
import {
  createInMemoryEventStore,
  type EventStore,
} from "@bernays/server/store";
import {
  type Injector,
  makeInjector,
  makeProjection,
  type Projection,
} from "@bernays/server/projections";
import {
  BrowserConfigId,
  CanonicalId,
  CorrelationId,
  EventId,
  getParticipantPlatformId,
  ParticipantId,
  type ParticipantId as ParticipantIdType,
  ThreadId,
} from "@bernays/server/core";

// Dojo plugin
import {
  LINKEDIN_DOJO_SCOPE,
  type LinkedInContact,
  linkedInDojoBehavior,
  type LinkedInDojoEvent,
  LinkedInDojoEventSchema,
} from "@bernays/plugins/linkedindojo";

// =============================================================================
// Types
// =============================================================================

/** Initial participant definition (before thread creation) */
interface ParticipantInit {
  readonly id: ParticipantIdType<"linkedin">;
  readonly name: string;
}

/** Enriched participant with contact info (after derivation) */
interface EnrichedParticipant {
  readonly id: ParticipantIdType<"linkedin">;
  readonly name: string;
  readonly contact?: LinkedInContact;
}

interface Message {
  readonly id: string;
  readonly senderId: string;
  readonly senderLabel: string;
  readonly content: string;
  readonly timestamp: string;
}

interface DojoConfig {
  readonly threadId: ThreadId;
  readonly participants: ParticipantInit[];
  readonly configId: BrowserConfigId;
}

/** Dojo environment with all the pieces */
interface DojoEnvironment {
  readonly store: EventStore;
  readonly injector: Injector<LinkedInDojoEvent>;
  readonly projection: Projection<LinkedInDojoEvent>;
}

// =============================================================================
// Helpers
// =============================================================================

const hashMessage = async (
  threadId: string,
  senderId: string,
  content: string,
  timestamp: string,
): Promise<CanonicalId> => {
  const data = `${threadId}:${senderId}:${content}:${timestamp}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data),
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return CanonicalId(hashHex.slice(0, 32));
};

/** Create a system message for display */
const systemMessage = (content: string): Message => ({
  id: `system-${Date.now()}`,
  senderId: "system",
  senderLabel: "System",
  content,
  timestamp: new Date().toISOString(),
});

// =============================================================================
// Dojo Setup Functions
// =============================================================================

const createDojoEnvironment = async (): Promise<DojoEnvironment> => {
  const store = createInMemoryEventStore();
  const injector = makeInjector(
    LINKEDIN_DOJO_SCOPE,
    LinkedInDojoEventSchema,
    store,
  );
  const projection = makeProjection(
    LINKEDIN_DOJO_SCOPE,
    LinkedInDojoEventSchema,
    store,
  );
  return { store, injector, projection };
};

/**
 * Derive enriched participants from thread + contact derivation.
 * Uses thread.anchor.participants which preserves ParticipantId<"linkedin"> type.
 */
const deriveEnrichedParticipants = async (
  projection: Projection<LinkedInDojoEvent>,
  threadId: ThreadId,
  initialParticipants: ParticipantInit[],
): Promise<EnrichedParticipant[]> => {
  const events = await Effect.runPromise(projection.query());
  const thread = linkedInDojoBehavior.deriveThread(events, threadId);

  if (!thread) {
    return initialParticipants.map((p) => ({
      id: p.id,
      name: p.name,
      contact: undefined,
    }));
  }

  const nameById = new Map(
    initialParticipants.map((p) => [p.id as string, p.name]),
  );

  return thread.anchor.participants.map((participantId) => {
    const contact = linkedInDojoBehavior.deriveContact?.(events, participantId);
    const name = contact?.name ?? nameById.get(participantId as string) ??
      getParticipantPlatformId(participantId);
    return { id: participantId, name, contact };
  });
};

const initializeThread = async (
  injector: Injector<LinkedInDojoEvent>,
  config: DojoConfig,
  firstSender: ParticipantInit,
  initialMessage: string,
): Promise<Message> => {
  const timestamp = new Date().toISOString();
  const canonicalId = await hashMessage(
    config.threadId,
    firstSender.id,
    initialMessage,
    timestamp,
  );

  // Inject auth events for all participants
  for (const participant of config.participants) {
    await Effect.runPromise(
      injector.append({
        scope: LINKEDIN_DOJO_SCOPE,
        type: "AuthObserved",
        eventId: EventId(crypto.randomUUID()),
        timestamp,
        correlationId: CorrelationId(crypto.randomUUID()),
        participantId: participant.id,
        configId: config.configId,
        authenticated: true,
      }),
    );
  }

  // Inject anchor message to create thread
  await Effect.runPromise(
    injector.append({
      scope: LINKEDIN_DOJO_SCOPE,
      type: "AnchorMessageObserved",
      eventId: EventId(crypto.randomUUID()),
      timestamp,
      correlationId: CorrelationId(crypto.randomUUID()),
      kind: "anchor",
      canonicalId,
      senderId: firstSender.id,
      content: initialMessage,
      threadId: config.threadId,
      anchor: {
        conversationId: config.threadId,
        participants: config.participants.map((p) => p.id),
      },
    }),
  );

  return {
    id: canonicalId,
    senderId: firstSender.id,
    senderLabel: firstSender.name,
    content: initialMessage,
    timestamp,
  };
};

// =============================================================================
// Hooks
// =============================================================================

const DEFAULT_PARTICIPANTS: ParticipantInit[] = [
  { id: ParticipantId("linkedin", "alice"), name: "Alice" },
  { id: ParticipantId("linkedin", "bob"), name: "Bob" },
];

interface UseDojoEnvironmentResult {
  readonly env: DojoEnvironment | null;
  readonly config: DojoConfig;
  readonly participants: EnrichedParticipant[];
  readonly initialMessage: Message | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refreshParticipants: () => Promise<void>;
}

/**
 * Hook to manage dojo environment setup and participant derivation.
 */
const useDojoEnvironment = (
  initialParticipants: ParticipantInit[],
): UseDojoEnvironmentResult => {
  const [env, setEnv] = useState<DojoEnvironment | null>(null);
  const [participants, setParticipants] = useState<EnrichedParticipant[]>([]);
  const [initialMessage, setInitialMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [config] = useState<DojoConfig>(() => ({
    threadId: ThreadId(`thread-${crypto.randomUUID().slice(0, 8)}`),
    participants: initialParticipants,
    configId: BrowserConfigId("dojo-browser"),
  }));

  const refreshParticipants = useCallback(async () => {
    if (!env) return;
    try {
      const enriched = await deriveEnrichedParticipants(
        env.projection,
        config.threadId,
        initialParticipants,
      );
      setParticipants(enriched);
    } catch (e) {
      console.error("Failed to refresh participants:", e);
    }
  }, [env, config.threadId, initialParticipants]);

  useEffect(() => {
    const init = async () => {
      try {
        const dojoEnv = await createDojoEnvironment();
        setEnv(dojoEnv);

        const firstMessage = await initializeThread(
          dojoEnv.injector,
          config,
          initialParticipants[0],
          "Hey! Starting a test conversation.",
        );

        const enriched = await deriveEnrichedParticipants(
          dojoEnv.projection,
          config.threadId,
          initialParticipants,
        );
        setParticipants(enriched);
        setInitialMessage(firstMessage);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    };
    init();
  }, [config, initialParticipants]);

  return {
    env,
    config,
    participants,
    initialMessage,
    loading,
    error,
    refreshParticipants,
  };
};

interface UseParticipantSelectorResult {
  readonly visible: boolean;
  readonly selectorIndex: number;
  readonly currentIndex: number;
  readonly currentParticipant: EnrichedParticipant | undefined;
  readonly show: () => void;
  readonly hide: () => void;
  readonly confirm: () => void;
  readonly heightOffset: number;
  readonly handleKey: (input: string, key: Key) => boolean;
}

/**
 * Hook to manage participant selector state and navigation.
 * Uses useListNavigation for arrow key/j/k navigation.
 */
const useParticipantSelector = (
  participants: EnrichedParticipant[],
): UseParticipantSelectorResult => {
  const [visible, setVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Use shared list navigation hook for selector navigation
  const selectorNav = useListNavigation(participants, { wrap: true });

  const show = useCallback(() => {
    selectorNav.setIndex(currentIndex);
    setVisible(true);
  }, [currentIndex, selectorNav]);

  const hide = useCallback(() => setVisible(false), []);

  const confirm = useCallback(() => {
    setCurrentIndex(selectorNav.selectedIndex);
    setVisible(false);
  }, [selectorNav.selectedIndex]);

  const selectByIndex = useCallback((index: number) => {
    setCurrentIndex(index);
    setVisible(false);
  }, []);

  // Handle keyboard input when selector is visible
  // Returns true if the key was handled
  const handleKey = useCallback((input: string, key: Key): boolean => {
    if (!visible) return false;

    // Number keys for direct selection
    if (isValidNumberKey(input, participants.length)) {
      selectByIndex(parseNumberKey(input));
      return true;
    }

    // Arrow keys / j/k to navigate
    if (key.upArrow || input === "k") {
      selectorNav.up();
      return true;
    }
    if (key.downArrow || input === "j") {
      selectorNav.down();
      return true;
    }

    // Enter to confirm
    if (key.return) {
      confirm();
      return true;
    }

    return false;
  }, [visible, participants.length, selectorNav, selectByIndex, confirm]);

  const heightOffset = visible ? participants.length + 3 : 0;
  const currentParticipant = participants[currentIndex];

  return {
    visible,
    selectorIndex: selectorNav.selectedIndex,
    currentIndex,
    currentParticipant,
    show,
    hide,
    confirm,
    heightOffset,
    handleKey,
  };
};

// =============================================================================
// Components
// =============================================================================

interface MessageListProps {
  readonly messages: Message[];
  readonly height: number;
  readonly currentSenderId: string;
}

const MessageList = (
  { messages, height, currentSenderId }: MessageListProps,
) => {
  const visibleMessages = messages.slice(-height);

  return (
    <Box flexDirection="column" height={height}>
      {visibleMessages.length === 0
        ? <Text dimColor>No messages yet. Type to send a message.</Text>
        : (
          visibleMessages.map((msg) => {
            const isCurrentUser = msg.senderId === currentSenderId;
            return (
              <Box key={msg.id}>
                <Text color={isCurrentUser ? "cyan" : "yellow"}>
                  [{relativeTime(msg.timestamp)}] {msg.senderLabel}:{" "}
                </Text>
                <Text>{msg.content}</Text>
              </Box>
            );
          })
        )}
    </Box>
  );
};

interface ChatInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly placeholder: string;
}

const ChatInput = (
  { value, onChange, onSubmit, placeholder }: ChatInputProps,
) => (
  <Box borderStyle="single" borderColor="cyan" paddingX={1}>
    <Text color="cyan">&gt;</Text>
    <TextInput
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={placeholder}
    />
  </Box>
);

interface ParticipantSelectorProps {
  readonly participants: EnrichedParticipant[];
  readonly selectedIndex: number;
  readonly visible: boolean;
}

const ParticipantSelector = (
  { participants, selectedIndex, visible }: ParticipantSelectorProps,
) => {
  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginBottom={1}
    >
      <Text color="magenta" bold>
        Select Participant (1-{participants.length}, Enter to confirm, Esc to
        cancel)
      </Text>
      {participants.map((p, idx) => {
        const isSelected = idx === selectedIndex;
        const displayName = p.contact?.name ?? p.name;
        const headline = p.contact?.headline;
        const lastActivity = p.contact?.lastInteraction
          ? relativeTime(p.contact.lastInteraction)
          : undefined;

        return (
          <Box key={p.id} paddingLeft={1}>
            <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {isSelected ? "▸ " : "  "}[{idx + 1}] {displayName}
            </Text>
            {headline && <Text dimColor>— {headline}</Text>}
            {lastActivity && <Text dimColor>(last: {lastActivity})</Text>}
          </Box>
        );
      })}
    </Box>
  );
};

// =============================================================================
// Main App
// =============================================================================

const DojoApp = () => {
  const { exit } = useApp();
  const { rows } = useTerminalSize();

  // Dojo environment and participants
  const dojo = useDojoEnvironment(DEFAULT_PARTICIPANTS);

  // Participant selector
  const selector = useParticipantSelector(dojo.participants);

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  // Set initial message once loaded
  useEffect(() => {
    if (dojo.initialMessage && messages.length === 0) {
      setMessages([dojo.initialMessage]);
    }
  }, [dojo.initialMessage, messages.length]);

  // Send message as current participant
  const sendMessage = useCallback(
    async (content: string) => {
      if (!dojo.env || !selector.currentParticipant || !content.trim()) return;

      const timestamp = new Date().toISOString();
      const canonicalId = await hashMessage(
        dojo.config.threadId,
        selector.currentParticipant.id,
        content,
        timestamp,
      );
      const lastMessage = messages[messages.length - 1];
      const predecessorId = lastMessage
        ? CanonicalId(lastMessage.id)
        : canonicalId;

      try {
        await Effect.runPromise(
          dojo.env.injector.append({
            scope: LINKEDIN_DOJO_SCOPE,
            type: "MessageObserved",
            eventId: EventId(crypto.randomUUID()),
            timestamp,
            correlationId: CorrelationId(crypto.randomUUID()),
            kind: "reply",
            canonicalId,
            senderId: selector.currentParticipant.id,
            content,
            threadId: dojo.config.threadId,
            predecessorId,
          }),
        );

        setMessages((prev) => [
          ...prev,
          {
            id: canonicalId,
            senderId: selector.currentParticipant!.id,
            senderLabel: selector.currentParticipant!.name,
            content,
            timestamp,
          },
        ]);

        await dojo.refreshParticipants();
        setInput("");
      } catch (e) {
        setMessages((
          prev,
        ) => [
          ...prev,
          systemMessage(`Error: ${e instanceof Error ? e.message : String(e)}`),
        ]);
      }
    },
    [dojo, selector.currentParticipant, messages],
  );

  // Handle chat commands
  const handleCommand = useCallback(
    (cmd: string) => {
      switch (cmd) {
        case "quit":
        case "q":
          exit();
          break;
        case "clear":
          setMessages([]);
          break;
        case "help":
          setMessages((prev) => [
            ...prev,
            systemMessage(
              "Commands: /quit, /clear, /help | Tab: open selector | 1-9: quick switch",
            ),
          ]);
          break;
        default:
          setMessages((
            prev,
          ) => [
            ...prev,
            systemMessage(`Unknown command: ${cmd}. Type /help for help.`),
          ]);
      }
      setInput("");
    },
    [exit],
  );

  // Handle input submission
  const handleSubmit = useCallback(
    (value: string) => {
      if (value.startsWith("/")) {
        handleCommand(value.slice(1).split(" ")[0]);
      } else {
        sendMessage(value);
      }
    },
    [handleCommand, sendMessage],
  );

  // Handle key input
  useInput((inputChar, key) => {
    // Escape: close selector or exit
    if (key.escape) {
      selector.visible ? selector.hide() : exit();
      return;
    }

    // Ctrl+C: exit
    if (key.ctrl && inputChar === "c") {
      exit();
      return;
    }

    // Delegate to selector if visible
    if (selector.handleKey(inputChar, key)) return;

    // Tab: open selector
    if (key.tab) {
      selector.show();
    }
  });

  // Loading/error states
  if (dojo.loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Initializing LinkedIn Dojo...</Text>
      </Box>
    );
  }

  if (dojo.error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error: {dojo.error}</Text>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  if (!selector.currentParticipant) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading participants...</Text>
      </Box>
    );
  }

  const contentHeight = rows - 6 - selector.heightOffset;

  return (
    <FullHeightLayout
      header={<Header title="LinkedIn Dojo" />}
      statusBar={
        <StatusBar>
          <Text>
            Sending as:{" "}
            <Text color="cyan" bold>{selector.currentParticipant.name}</Text>
            {selector.currentParticipant.contact?.lastInteraction && (
              <Text dimColor>
                (last: {relativeTime(
                  selector.currentParticipant.contact.lastInteraction,
                )})
              </Text>
            )}
            {" | "}Tab to select | /help | ESC to quit
          </Text>
        </StatusBar>
      }
    >
      <Box flexDirection="column" flexGrow={1}>
        <ParticipantSelector
          participants={dojo.participants}
          selectedIndex={selector.selectorIndex}
          visible={selector.visible}
        />
        <MessageList
          messages={messages}
          height={contentHeight}
          currentSenderId={selector.currentParticipant.id}
        />
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={`Message as ${selector.currentParticipant.name}...`}
        />
      </Box>
    </FullHeightLayout>
  );
};

// =============================================================================
// Entry Point
// =============================================================================

runApp(<DojoApp />);
