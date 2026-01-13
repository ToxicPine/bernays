#!/usr/bin/env -S deno run -A
// =============================================================================
// manage-browser-configs.tsx — Browser Config Manager TUI (Ink)
// =============================================================================

import { useState, useEffect, type FC } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import { parseArgs } from "@std/cli";
import { Effect, Option } from "effect";
import {
  createPostgresConfigStore,
  type ConfigStoreService,
} from "@bernays/server/store";
import { BrowserConfigId, ExtensionId } from "@bernays/server/core";
import type { BrowserConfig, ProxyConfig } from "@bernays/server/backend";
import {
  Header,
  StatusBar,
  FullHeightLayout,
  ErrorBanner,
  useAsyncOperation,
  toAppError,
  type AppError,
  runApp,
  requireDatabaseUrl,
  runMain,
  useContentHeight,
  useTerminalSize,
} from "./lib/ink.tsx";
import {
  createBindings,
  useKeyHandler,
  type KeyBinding,
} from "./lib/keybindings.tsx";
import { useListNavigation, usePagination } from "./lib/hooks.tsx";

// =============================================================================
// Types
// =============================================================================

type View =
  | { type: "list" }
  | { type: "detail"; config: BrowserConfig }
  | { type: "create"; step: CreateStep; data: Partial<CreateData> }
  | { type: "edit"; config: BrowserConfig; step: EditStep; data: Partial<CreateData> }
  | { type: "delete"; config: BrowserConfig }
  | { type: "confirm"; action: "create" | "edit"; data: CreateData; original?: BrowserConfig };

type CreateStep = "id" | "context" | "extensions" | "proxy-ask" | "proxy-server" | "proxy-user" | "proxy-pass";
type EditStep = "context" | "extensions" | "proxy-action" | "proxy-server" | "proxy-user" | "proxy-pass";

interface CreateData {
  id: string;
  context: string;
  extensions: string;
  proxyServer?: string;
  proxyUser?: string;
  proxyPass?: string;
}

// =============================================================================
// Components
// =============================================================================

const ConfigRow: FC<{ config: BrowserConfig; index: number; selected: boolean; columns: number }> = (
  props: { config: BrowserConfig; index: number; selected: boolean; columns: number }
) => {
  const c = props.config;
  const extCount = c.extensionIds.length;
  // Distribute widths proportionally: ~35% id, ~40% context, ~15% ext, ~10% proxy
  // Accounting for prefix (4 chars) and labels (20 chars total)
  const availableWidth = Math.max(60, props.columns - 24);
  const idWidth = Math.max(12, Math.floor(availableWidth * 0.35));
  const ctxWidth = Math.max(10, Math.floor(availableWidth * 0.40));
  const displayId = c.id.length > idWidth ? c.id.slice(0, idWidth - 3) + "..." : c.id.padEnd(idWidth);
  const displayCtx = c.context.length > ctxWidth ? c.context.slice(0, ctxWidth - 3) + "..." : c.context.padEnd(ctxWidth);
  return (
    <Box>
      <Text color={props.selected ? "green" : "white"}>
        {props.selected ? "> " : "  "}
        <Text bold>[{String(props.index + 1).padStart(2)}]</Text>{" "}
        <Text color="cyan">{displayId}</Text>{" "}
        <Text dimColor>ctx:</Text> {displayCtx}{" "}
        <Text dimColor>ext:</Text> {String(extCount).padStart(2)}{" "}
        <Text dimColor>proxy:</Text>{" "}
        <Text color={c.proxy ? "green" : "gray"}>{c.proxy ? "yes" : "no "}</Text>
      </Text>
    </Box>
  );
};

// =============================================================================
// List View
// =============================================================================

interface ListViewProps {
  store: ConfigStoreService;
  onView: (config: BrowserConfig) => void;
  onCreate: () => void;
  onEdit: (config: BrowserConfig) => void;
  onDelete: (config: BrowserConfig) => void;
}

const ListView: FC<ListViewProps> = (props: ListViewProps) => {
  const { exit } = useApp();
  const { data: configs, error, loading, run, clearError } = useAsyncOperation<readonly BrowserConfig[]>();
  const { columns } = useTerminalSize();

  // Dynamic page size: Chrome: Header (3) + margins (2) + status bar (3) + error banner (4) = 12 lines
  const availableHeight = useContentHeight(error ? 12 : 8);
  const pageSize = Math.max(5, availableHeight);

  useEffect(() => {
    run(async () => {
      return await Effect.runPromise(props.store.list());
    }, "Failed to Load Configs");
  }, []);

  const configList = configs || [];

  // Navigation and pagination
  const pagination = usePagination(configList, pageSize);
  const nav = useListNavigation(pagination.pageItems);

  // Keybindings
  const getSelectedConfig = () => configList[pagination.pageStartIndex + nav.selectedIndex];

  const customBindings: KeyBinding[] = [
    { key: "v", label: "view", handler: () => { const c = getSelectedConfig(); if (c) props.onView(c); } },
    { key: "c", label: "create", handler: () => props.onCreate() },
    { key: "e", label: "edit", handler: () => { const c = getSelectedConfig(); if (c) props.onEdit(c); } },
    { key: "d", label: "delete", handler: () => { const c = getSelectedConfig(); if (c) props.onDelete(c); } },
    ...(error ? [{ key: "r", label: "retry", handler: () => {
      run(async () => await Effect.runPromise(props.store.list()), "Failed to Load Configs");
    }}] : []),
  ];

  const bindings = createBindings({
    navigation: true,
    pagination: pagination.totalPages > 1,
    onUp: nav.up,
    onDown: nav.down,
    onPageUp: () => { pagination.prevPage(); nav.reset(); },
    onPageDown: () => { pagination.nextPage(); nav.reset(); },
    onSelect: () => { const c = getSelectedConfig(); if (c) props.onView(c); },
    onQuit: exit,
    custom: customBindings,
  });

  // Error dismissal handler
  useInput((input: string, key: { escape: boolean }) => {
    if (error && error.recoverable && (input || key.escape)) {
      clearError();
    }
  });

  useKeyHandler(bindings, [pagination.pageStartIndex, nav.selectedIndex, error]);

  const statusHints = bindings.hints + (pagination.totalPages > 1 ? ` | ${pagination.page + 1}/${pagination.totalPages}` : "");

  return (
    <FullHeightLayout
      header={<Header title="Browser Config Manager" />}
      statusBar={<StatusBar>{statusHints}</StatusBar>}
    >
      {error && <ErrorBanner error={error} onDismiss={clearError} />}
      {loading ? (
        <Text color="cyan">Loading...</Text>
      ) : configList.length === 0 && !error ? (
        <Text dimColor>No configs found.</Text>
      ) : configList.length > 0 ? (
        <>
          <Text dimColor>
            Showing {pagination.pageStartIndex + 1}-{Math.min(pagination.pageStartIndex + pageSize, configList.length)} of {configList.length}:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {pagination.pageItems.map((c, i) => (
              <ConfigRow key={c.id} config={c} index={pagination.pageStartIndex + i} selected={nav.selectedIndex === i} columns={columns} />
            ))}
          </Box>
        </>
      ) : null}
    </FullHeightLayout>
  );
};

// =============================================================================
// Detail View
// =============================================================================

interface DetailViewProps {
  config: BrowserConfig;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const DetailView: FC<DetailViewProps> = (props: DetailViewProps) => {
  const { exit } = useApp();
  const c = props.config;

  const bindings = createBindings({
    onBack: props.onBack,
    onQuit: exit,
    custom: [
      { key: "e", label: "edit", handler: props.onEdit },
      { key: "d", label: "delete", handler: props.onDelete },
    ],
  });

  useKeyHandler(bindings);

  return (
    <FullHeightLayout
      header={<Header title="Config Details" />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      <Box flexDirection="column" marginY={1}>
        <Text><Text bold>ID:</Text> <Text color="cyan">{c.id}</Text></Text>
        <Text><Text bold>Context:</Text> {c.context}</Text>
        <Text><Text bold>Extensions:</Text> {c.extensionIds.length > 0 ? c.extensionIds.join(", ") : <Text dimColor>(none)</Text>}</Text>
        {c.proxy ? (
          <>
            <Text><Text bold>Proxy Server:</Text> {c.proxy.server}</Text>
            <Text><Text bold>Proxy User:</Text> {c.proxy.username || <Text dimColor>(none)</Text>}</Text>
            <Text><Text bold>Proxy Pass:</Text> {c.proxy.password ? <Text dimColor>[set]</Text> : <Text dimColor>(none)</Text>}</Text>
          </>
        ) : (
          <Text><Text bold>Proxy:</Text> <Text dimColor>(none)</Text></Text>
        )}
      </Box>
    </FullHeightLayout>
  );
};

// =============================================================================
// Create/Edit Form
// =============================================================================

interface FormViewProps {
  mode: "create" | "edit";
  step: CreateStep | EditStep;
  data: Partial<CreateData>;
  original?: BrowserConfig;
  onUpdate: (field: string, value: string) => void;
  onNext: (value: string) => void;
  onCancel: () => void;
}

const FormView: FC<FormViewProps> = (props: FormViewProps) => {
  const [value, setValue] = useState("");

  useEffect(() => {
    // Pre-fill with existing data
    if (props.step === "context" && props.data.context) setValue(props.data.context);
    else if (props.step === "extensions" && props.data.extensions) setValue(props.data.extensions);
    else if (props.step === "proxy-server" && props.data.proxyServer) setValue(props.data.proxyServer);
    else if (props.step === "proxy-user" && props.data.proxyUser) setValue(props.data.proxyUser);
    else setValue("");
  }, [props.step]);

  useInput((_input: string, key: { escape: boolean }) => {
    if (key.escape) props.onCancel();
  });

  const handleSubmit = (val: string) => {
    props.onUpdate(props.step, val);
    props.onNext(val);
  };

  const labels: Record<string, { label: string; hint?: string }> = {
    id: { label: "Config ID", hint: "Unique identifier" },
    context: { label: "Context", hint: "Browserbase context or profile name" },
    extensions: { label: "Extension IDs", hint: "Comma-separated, or empty for none" },
    "proxy-ask": { label: "Configure proxy?", hint: "y/n" },
    "proxy-server": { label: "Proxy Server", hint: "host:port" },
    "proxy-user": { label: "Proxy Username", hint: "Optional" },
    "proxy-pass": { label: "Proxy Password", hint: "Optional, hidden" },
    "proxy-action": { label: "Proxy action", hint: "[k]eep / [e]dit / [r]emove" },
  };

  const current = labels[props.step] || { label: props.step };
  const isYesNo = props.step === "proxy-ask";
  const isAction = props.step === "proxy-action";

  return (
    <FullHeightLayout
      header={<Header title={props.mode === "create" ? "Create Config" : "Edit Config"} />}
      statusBar={<StatusBar>Enter to continue | Escape to cancel</StatusBar>}
    >
      {props.original && (
        <Box marginBottom={1}>
          <Text dimColor>Editing: {props.original.id}</Text>
        </Box>
      )}
      <Box flexDirection="column">
        <Text bold>{current.label}</Text>
        {current.hint && <Text dimColor>{current.hint}</Text>}
        <Box marginTop={1}>
          {isYesNo || isAction ? (
            <Text>
              <Text color="cyan">{"> "}</Text>
              <TextInput
                value={value}
                onChange={(v: string) => setValue(v)}
                onSubmit={handleSubmit}
              />
            </Text>
          ) : (
            <Text>
              <Text color="cyan">{"> "}</Text>
              <TextInput
                value={value}
                onChange={(v: string) => setValue(v)}
                onSubmit={handleSubmit}
                mask={props.step === "proxy-pass" ? "*" : undefined}
              />
            </Text>
          )}
        </Box>
      </Box>
    </FullHeightLayout>
  );
};

// =============================================================================
// Confirm View
// =============================================================================

interface ConfirmViewProps {
  action: "create" | "edit";
  data: CreateData;
  original?: BrowserConfig;
  onConfirm: () => void;
  onCancel: () => void;
  error?: AppError | null;
  saving?: boolean;
  onDismissError?: () => void;
}

const ConfirmView: FC<ConfirmViewProps> = (props: ConfirmViewProps) => {
  const { exit } = useApp();

  const bindings = createBindings({
    onQuit: exit,
    custom: [
      { key: "y", label: "confirm", handler: props.onConfirm, enabled: !props.saving },
      { key: "n", label: "cancel", handler: props.onCancel, enabled: !props.saving },
    ],
  });

  // Error dismissal and escape handling
  useInput((_input: string, key: { escape: boolean }) => {
    if (props.error && props.onDismissError) {
      props.onDismissError();
      return;
    }
    if (props.saving) return;
    if (key.escape) props.onCancel();
  });

  useKeyHandler(bindings, [props.saving, props.error]);

  const d = props.data;
  const hasProxy = d.proxyServer && d.proxyServer.length > 0;

  return (
    <FullHeightLayout
      header={<Header title={props.action === "create" ? "Confirm Create" : "Confirm Edit"} />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      {props.error && <ErrorBanner error={props.error} onDismiss={props.onDismissError} />}
      <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text><Text bold>ID:</Text> <Text color="cyan">{d.id}</Text></Text>
        <Text><Text bold>Context:</Text> {d.context}</Text>
        <Text><Text bold>Extensions:</Text> {d.extensions || <Text dimColor>(none)</Text>}</Text>
        {hasProxy ? (
          <>
            <Text><Text bold>Proxy:</Text> {d.proxyServer}</Text>
            {d.proxyUser && <Text><Text bold>User:</Text> {d.proxyUser}</Text>}
            {d.proxyPass && <Text><Text bold>Pass:</Text> <Text dimColor>[set]</Text></Text>}
          </>
        ) : (
          <Text><Text bold>Proxy:</Text> <Text dimColor>(none)</Text></Text>
        )}
      </Box>
      {props.saving ? (
        <Text color="cyan">Saving...</Text>
      ) : (
        <Text bold color="yellow">Save this config? (y/n)</Text>
      )}
    </FullHeightLayout>
  );
};

// =============================================================================
// Delete Confirm View
// =============================================================================

interface DeleteViewProps {
  config: BrowserConfig;
  store: ConfigStoreService;
  onDone: () => void;
  onCancel: () => void;
}

const DeleteView: FC<DeleteViewProps> = (props: DeleteViewProps) => {
  const { exit } = useApp();
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    if (deleting) return;
    setDeleting(true);
    Effect.runPromise(props.store.remove(props.config.id))
      .then(() => {
        setDeleted(true);
        setTimeout(props.onDone, 1000);
      })
      .catch((e) => {
        setDeleting(false);
        setError(toAppError(e, "Delete Failed"));
      });
  };

  const bindings = createBindings({
    onQuit: exit,
    custom: [
      { key: "y", label: "delete", handler: handleDelete },
      { key: "n", label: "cancel", handler: props.onCancel },
    ],
  });

  // Error dismissal and escape handling
  useInput((_input: string, key: { escape: boolean }) => {
    if (error) {
      setError(null);
      return;
    }
    if (key.escape) props.onCancel();
  });

  useKeyHandler(bindings, [deleting, error]);

  if (deleted) {
    return (
      <FullHeightLayout
        header={<Header title="Delete Config" />}
        statusBar={<StatusBar>Returning to list...</StatusBar>}
      >
        <Text color="green">Config deleted successfully.</Text>
      </FullHeightLayout>
    );
  }

  return (
    <FullHeightLayout
      header={<Header title="Delete Config" />}
      statusBar={<StatusBar>{bindings.hints}</StatusBar>}
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <Box marginY={1}>
        <Text>Delete config <Text color="cyan">{props.config.id}</Text>?</Text>
      </Box>
      {deleting ? (
        <Text color="cyan">Deleting...</Text>
      ) : (
        <Text bold color="red">This cannot be undone. (y/n)</Text>
      )}
    </FullHeightLayout>
  );
};

// =============================================================================
// Main App
// =============================================================================

interface AppProps {
  store: ConfigStoreService;
}

const App: FC<AppProps> = (props: AppProps) => {
  const [view, setView] = useState<View>({ type: "list" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = () => setRefreshKey((k) => k + 1);

  const buildConfig = (data: CreateData, originalId?: string): BrowserConfig => {
    const extensionIds = data.extensions
      ? data.extensions.split(",").map((s) => ExtensionId(s.trim())).filter((s) => s)
      : [];
    const proxy: ProxyConfig | undefined = data.proxyServer
      ? { server: data.proxyServer, username: data.proxyUser, password: data.proxyPass }
      : undefined;
    return {
      id: BrowserConfigId(originalId || data.id),
      context: data.context,
      extensionIds,
      proxy,
    };
  };

  const saveConfig = async (data: CreateData, original?: BrowserConfig) => {
    setSaving(true);
    setSaveError(null);
    try {
      const config = buildConfig(data, original?.id);
      await Effect.runPromise(props.store.upsert(config));
      refresh();
      setView({ type: "list" });
    } catch (e) {
      setSaveError(toAppError(e, "Save Failed"));
    } finally {
      setSaving(false);
    }
  };

  // Create flow
  if (view.type === "create") {
    const steps: CreateStep[] = ["id", "context", "extensions", "proxy-ask", "proxy-server", "proxy-user", "proxy-pass"];
    const stepIdx = steps.indexOf(view.step as CreateStep);

    const handleNext = (currentValue: string) => {
      const d = { ...view.data, [view.step]: currentValue };
      if (view.step === "proxy-ask") {
        if (currentValue.toLowerCase() !== "y") {
          setView({ type: "confirm", action: "create", data: d as CreateData });
          return;
        }
      }
      if (view.step === "proxy-pass") {
        setView({ type: "confirm", action: "create", data: d as CreateData });
        return;
      }
      const nextStep = steps[stepIdx + 1];
      if (nextStep) setView({ ...view, step: nextStep, data: d });
    };

    return (
      <FormView
        mode="create"
        step={view.step}
        data={view.data}
        onUpdate={(field: string, value: string) => {
          setView({ ...view, data: { ...view.data, [field]: value } });
        }}
        onNext={handleNext}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  // Edit flow
  if (view.type === "edit") {
    const steps: EditStep[] = ["context", "extensions", "proxy-action", "proxy-server", "proxy-user", "proxy-pass"];
    const stepIdx = steps.indexOf(view.step as EditStep);

    const handleNext = (currentValue: string) => {
      const d = { ...view.data, [view.step]: currentValue };
      if (view.step === "proxy-action") {
        const action = currentValue || "k";
        if (action.toLowerCase() === "k") {
          // Keep existing proxy
          const existing = view.config.proxy;
          const finalData: CreateData = {
            id: view.config.id,
            context: d.context || view.config.context,
            extensions: d.extensions ?? view.config.extensionIds.join(", "),
            proxyServer: existing?.server,
            proxyUser: existing?.username,
            proxyPass: existing?.password,
          };
          setView({ type: "confirm", action: "edit", data: finalData, original: view.config });
          return;
        } else if (action.toLowerCase() === "r") {
          // Remove proxy
          const finalData: CreateData = {
            id: view.config.id,
            context: d.context || view.config.context,
            extensions: d.extensions ?? view.config.extensionIds.join(", "),
          };
          setView({ type: "confirm", action: "edit", data: finalData, original: view.config });
          return;
        }
        // Continue to edit proxy
      }
      if (view.step === "proxy-pass") {
        const finalData: CreateData = {
          id: view.config.id,
          context: d.context || view.config.context,
          extensions: d.extensions ?? view.config.extensionIds.join(", "),
          proxyServer: d.proxyServer,
          proxyUser: d.proxyUser,
          proxyPass: d.proxyPass,
        };
        setView({ type: "confirm", action: "edit", data: finalData, original: view.config });
        return;
      }
      const nextStep = steps[stepIdx + 1];
      if (nextStep) setView({ ...view, step: nextStep, data: d });
    };

    return (
      <FormView
        mode="edit"
        step={view.step}
        data={view.data}
        original={view.config}
        onUpdate={(field: string, value: string) => {
          setView({ ...view, data: { ...view.data, [field]: value } });
        }}
        onNext={handleNext}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "confirm") {
    return (
      <ConfirmView
        action={view.action}
        data={view.data}
        original={view.original}
        onConfirm={() => saveConfig(view.data, view.original)}
        onCancel={() => { setSaveError(null); setView({ type: "list" }); }}
        error={saveError}
        saving={saving}
        onDismissError={() => setSaveError(null)}
      />
    );
  }

  if (view.type === "delete") {
    return (
      <DeleteView
        config={view.config}
        store={props.store}
        onDone={() => { refresh(); setView({ type: "list" }); }}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "detail") {
    return (
      <DetailView
        config={view.config}
        onBack={() => setView({ type: "list" })}
        onEdit={() => setView({
          type: "edit",
          config: view.config,
          step: "context",
          data: {
            context: view.config.context,
            extensions: view.config.extensionIds.join(", "),
            proxyServer: view.config.proxy?.server,
            proxyUser: view.config.proxy?.username,
            proxyPass: view.config.proxy?.password,
          },
        })}
        onDelete={() => setView({ type: "delete", config: view.config })}
      />
    );
  }

  return (
    <ListView
      key={refreshKey}
      store={props.store}
      onView={(c: BrowserConfig) => setView({ type: "detail", config: c })}
      onCreate={() => setView({ type: "create", step: "id", data: {} })}
      onEdit={(c: BrowserConfig) => setView({
        type: "edit",
        config: c,
        step: "context",
        data: {
          context: c.context,
          extensions: c.extensionIds.join(", "),
          proxyServer: c.proxy?.server,
          proxyUser: c.proxy?.username,
          proxyPass: c.proxy?.password,
        },
      })}
      onDelete={(c: BrowserConfig) => setView({ type: "delete", config: c })}
    />
  );
};

// =============================================================================
// CLI (non-interactive)
// =============================================================================

const cliList = async (store: ConfigStoreService): Promise<void> => {
  try {
    const configs = await Effect.runPromise(store.list());
    if (configs.length === 0) {
      console.log("No configs found.");
      return;
    }
    console.log("\nBrowser Configs\n" + "─".repeat(80));
    for (let i = 0; i < configs.length; i++) {
      const c = configs[i];
      console.log(`  [${i + 1}] ${c.id.padEnd(24)} ctx:${c.context.slice(0, 18).padEnd(18)} ext:${c.extensionIds.length} proxy:${c.proxy ? "yes" : "no"}`);
    }
    console.log("─".repeat(80) + `\nTotal: ${configs.length}`);
  } catch (e) {
    const error = toAppError(e, "Failed to list configs");
    console.error(`Error: ${error.title} - ${error.message}`);
    Deno.exit(1);
  }
};

const cliView = async (store: ConfigStoreService, id: string): Promise<void> => {
  try {
    const result = await Effect.runPromise(store.get(BrowserConfigId(id)));
    if (Option.isNone(result)) {
      console.error(`Config not found: ${id}`);
      return;
    }
    const c = result.value;
    console.log("\nConfig Details\n" + "─".repeat(50));
    console.log(`ID:         ${c.id}`);
    console.log(`Context:    ${c.context}`);
    console.log(`Extensions: ${c.extensionIds.join(", ") || "(none)"}`);
    if (c.proxy) {
      console.log(`Proxy:      ${c.proxy.server}`);
      console.log(`Proxy User: ${c.proxy.username || "(none)"}`);
      console.log(`Proxy Pass: ${c.proxy.password ? "[set]" : "(none)"}`);
    } else {
      console.log(`Proxy:      (none)`);
    }
  } catch (e) {
    const error = toAppError(e, "Failed to get config");
    console.error(`Error: ${error.title} - ${error.message}`);
    Deno.exit(1);
  }
};

// =============================================================================
// Main
// =============================================================================

const main = async (): Promise<void> => {
  const args = parseArgs(Deno.args, {
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(`manage-browser-configs.tsx — Browser Config Manager

USAGE
  bernays configure-browsers [COMMAND]

COMMANDS
  (none)        Interactive TUI
  list          List all configs
  view <id>     View config details`);
    return;
  }

  const databaseUrl = requireDatabaseUrl();
  const store = await createPostgresConfigStore({ connectionString: databaseUrl });
  const [cmd, ...rest] = args._;

  if (cmd === "list") {
    await cliList(store);
  } else if (cmd === "view") {
    if (!rest[0]) {
      console.error("Error: 'view' requires a config ID");
      Deno.exit(1);
    }
    await cliView(store, String(rest[0]));
  } else {
    await runApp(<App store={store} />);
  }
};

if (import.meta.main) {
  runMain(main);
}
