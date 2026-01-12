// packages/browser/src/handlers/proxy/handlers.ts
// Proxy configuration handlers - for verifying and managing proxy connectivity

type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

declare global {
  interface Window {
    __registerCommand: <TReq, TRes>(
      command: string,
      handler: (payload: TReq) => Promise<CommandResult<TRes>>,
    ) => void;
  }
}

// ============================================================================
// Check Current IP
// ============================================================================

interface IpCheckResult {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  isp?: string;
  isResidential?: boolean;
}

window.__registerCommand<void, IpCheckResult>("proxy:checkIp", async () => {
  try {
    // Try multiple IP check services for reliability
    const services = [
      {
        url: "https://api.ipify.org?format=json",
        parse: (data: { ip: string }) => ({ ip: data.ip }),
      },
      {
        url: "https://ipinfo.io/json",
        parse: (data: {
          ip: string;
          city?: string;
          region?: string;
          country?: string;
          org?: string;
        }) => ({
          ip: data.ip,
          city: data.city,
          region: data.region,
          country: data.country,
          isp: data.org,
        }),
      },
      {
        url: "https://api.myip.com",
        parse: (data: { ip: string; country?: string }) => ({
          ip: data.ip,
          country: data.country,
        }),
      },
    ];

    for (const service of services) {
      try {
        const response = await fetch(service.url, {
          credentials: "omit",
          cache: "no-store",
        });

        if (response.ok) {
          const data = await response.json();
          const result = service.parse(data);

          // Try to detect if IP is residential
          const isp = (result as IpCheckResult).isp?.toLowerCase() ?? "";
          const isResidential =
            !isp.includes("hosting") &&
            !isp.includes("cloud") &&
            !isp.includes("datacenter") &&
            !isp.includes("server") &&
            !isp.includes("vps");

          return {
            ok: true,
            value: {
              ...result,
              isResidential,
            } as IpCheckResult,
          };
        }
      } catch {
        // Try next service
        continue;
      }
    }

    return {
      ok: false,
      error: {
        code: "AllServicesFailed",
        message: "Could not determine IP from any service",
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "Unknown",
        message: error.message,
        details: error,
      },
    };
  }
});

// ============================================================================
// Verify Proxy Connectivity
// ============================================================================

interface ProxyVerifyResult {
  connected: boolean;
  latencyMs: number;
  exitIp: string;
  exitLocation?: string;
}

window.__registerCommand<
  { expectedIpPrefix?: string },
  ProxyVerifyResult
>("proxy:verify", async (payload) => {
  try {
    const startTime = performance.now();

    const response = await fetch("https://api.ipify.org?format=json", {
      credentials: "omit",
      cache: "no-store",
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: "NetworkError",
          message: `HTTP ${response.status}`,
        },
      };
    }

    const data = (await response.json()) as { ip: string };
    const exitIp = data.ip;

    // Verify IP matches expected prefix if provided
    if (payload.expectedIpPrefix && !exitIp.startsWith(payload.expectedIpPrefix)) {
      return {
        ok: false,
        error: {
          code: "IpMismatch",
          message: `Expected IP starting with ${payload.expectedIpPrefix}, got ${exitIp}`,
        },
      };
    }

    // Get location info
    let exitLocation: string | undefined;
    try {
      const geoResponse = await fetch(`https://ipinfo.io/${exitIp}/json`, {
        credentials: "omit",
      });
      if (geoResponse.ok) {
        const geoData = (await geoResponse.json()) as {
          city?: string;
          region?: string;
          country?: string;
        };
        exitLocation = [geoData.city, geoData.region, geoData.country]
          .filter(Boolean)
          .join(", ");
      }
    } catch {
      // Location lookup failed, continue without it
    }

    return {
      ok: true,
      value: {
        connected: true,
        latencyMs,
        exitIp,
        exitLocation,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error: {
        code: "ConnectionFailed",
        message: error.message,
        details: error,
      },
    };
  }
});

// ============================================================================
// Test Proxy for Platform Access
// ============================================================================

interface PlatformAccessResult {
  accessible: boolean;
  loadTimeMs: number;
  blockedReason?: string;
}

window.__registerCommand<
  { platform: "linkedin" | "x" | "reddit" },
  PlatformAccessResult
>("proxy:testPlatformAccess", async (payload) => {
  try {
    const platformUrls: Record<string, string> = {
      linkedin: "https://www.linkedin.com/",
      x: "https://x.com/",
      reddit: "https://www.reddit.com/",
    };

    const url = platformUrls[payload.platform];
    if (!url) {
      return {
        ok: false,
        error: {
          code: "UnknownPlatform",
          message: `Unknown platform: ${payload.platform}`,
        },
      };
    }

    const startTime = performance.now();

    const response = await fetch(url, {
      credentials: "omit",
      mode: "no-cors", // Can't read response, but can check if blocked
      cache: "no-store",
    });

    const loadTimeMs = Math.round(performance.now() - startTime);

    // With no-cors we can't read the response, but if fetch completes
    // without throwing, the connection was made
    // Check for common block indicators
    const accessible = response.type === "opaque" || response.ok;

    return {
      ok: true,
      value: {
        accessible,
        loadTimeMs,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Detect common block patterns
    let blockedReason: string | undefined;
    if (error.message.includes("blocked")) {
      blockedReason = "Connection blocked by platform";
    } else if (error.message.includes("timeout")) {
      blockedReason = "Connection timeout - possible IP block";
    } else if (error.message.includes("refused")) {
      blockedReason = "Connection refused";
    }

    return {
      ok: true,
      value: {
        accessible: false,
        loadTimeMs: 0,
        blockedReason: blockedReason ?? error.message,
      },
    };
  }
});

// ============================================================================
// Get Network Fingerprint
// ============================================================================

interface NetworkFingerprint {
  userAgent: string;
  language: string;
  languages: string[];
  platform: string;
  timezone: string;
  screenResolution: string;
  colorDepth: number;
  webglVendor?: string;
  webglRenderer?: string;
}

window.__registerCommand<void, NetworkFingerprint>(
  "proxy:getFingerprint",
  async () => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");

      let webglVendor: string | undefined;
      let webglRenderer: string | undefined;

      if (gl) {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }

      return {
        ok: true,
        value: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: [...navigator.languages],
          platform: navigator.platform,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          screenResolution: `${screen.width}x${screen.height}`,
          colorDepth: screen.colorDepth,
          webglVendor,
          webglRenderer,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        ok: false,
        error: {
          code: "Unknown",
          message: error.message,
          details: error,
        },
      };
    }
  },
);

export {};
