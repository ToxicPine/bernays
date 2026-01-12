// Chrome Extension API type definitions for Manifest V3

declare namespace chrome {
  namespace runtime {
    interface InstalledDetails {
      reason: "install" | "update" | "chrome_update" | "shared_module_update";
      previousVersion?: string;
      id?: string;
    }

    interface Port {
      name: string;
      disconnect(): void;
      onDisconnect: {
        addListener(callback: () => void): void;
        removeListener(callback: () => void): void;
      };
      onMessage: {
        addListener(callback: (message: unknown, port: Port) => void): void;
        removeListener(callback: (message: unknown, port: Port) => void): void;
      };
      postMessage(message: unknown): void;
    }

    interface OnInstalledEvent {
      addListener(callback: (details: InstalledDetails) => void): void;
      removeListener(callback: (details: InstalledDetails) => void): void;
    }

    const getURL: (path: string) => string;
    const onInstalled: OnInstalledEvent;
  }
}
