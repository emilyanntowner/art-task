/**
 * EnvironmentGate — wraps the task and enforces environment requirements.
 *
 * Checks (all must hold to run):
 *   1. Fine pointer (mouse/trackpad — blocks touch-only devices)
 *   2. Viewport ≥ 1280 × 700
 *   3. Fullscreen
 *   4. Window focused and tab visible
 *
 * When any check fails an overlay blocks the task and the violation is logged.
 * Dev bypass: add ?nogate to the URL.
 *
 * Browser capability gate (checked once on mount): requires fetch + basic DOM APIs.
 * Old browsers that fail are shown a permanent "update your browser" screen.
 */

import { useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { postEvent } from "../api";

const MIN_WIDTH  = 1280;
const MIN_HEIGHT = 700;

// ── Environment check ──────────────────────────────────────────────────────────

type EnvCheck = {
  fine_pointer: boolean;
  big_enough:   boolean;
  fullscreen:   boolean;
  focused:      boolean;
};

function checkEnv(): EnvCheck {
  return {
    fine_pointer: window.matchMedia("(any-pointer: fine)").matches,
    big_enough:   window.innerWidth >= MIN_WIDTH && window.innerHeight >= MIN_HEIGHT,
    fullscreen:   !!(document.fullscreenElement || (document as any).webkitFullscreenElement),
    focused:      document.hasFocus() && document.visibilityState !== "hidden",
  };
}

function envOk(e: EnvCheck): boolean {
  return e.fine_pointer && e.big_enough && e.fullscreen && e.focused;
}

// ── Browser capability gate ────────────────────────────────────────────────────

function browserSupported(): boolean {
  try {
    return (
      typeof fetch === "function" &&
      typeof AbortController === "function" &&
      typeof Promise === "function"
    );
  } catch {
    return false;
  }
}

// ── Overlay components ─────────────────────────────────────────────────────────

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "#fff", borderRadius: "1rem", padding: "2.5rem 2rem",
        maxWidth: "26rem", width: "90%", textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        {children}
      </div>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1e293b", marginBottom: "0.6rem" }}>{children}</p>;
}

function Body({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: "0.9rem", color: "#64748b", lineHeight: 1.6, margin: 0 }}>{children}</p>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: "1.5rem", padding: "0.65rem 1.75rem",
        background: "#1e293b", color: "#fff", border: "none",
        borderRadius: "0.5rem", fontSize: "0.9rem", fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  sessionId: string;
  token:     string;
  children:  ReactNode;
};

export default function EnvironmentGate({ sessionId, token, children }: Props) {
  const nogate = new URLSearchParams(window.location.search).has("nogate");

  const [supported, setSupported]   = useState(true);
  const [env, setEnv]               = useState<EnvCheck>(checkEnv);
  const [fsRequesting, setFsReq]    = useState(false);

  // Violation tracking
  const violationCount  = useRef(0);
  const violationStart  = useRef<number | null>(null);
  const cumAwayMs       = useRef(0);
  const maxAwayMs       = useRef(0);
  const prevOk          = useRef(nogate ? true : envOk(checkEnv()));
  const mounted         = useRef(false);

  const log = useCallback((type: string, payload?: Record<string, unknown>) => {
    postEvent(sessionId, token, { type, payload }).catch(() => {});
  }, [sessionId, token]);

  // Browser capability check on mount
  useEffect(() => {
    if (!browserSupported()) {
      log("browser_unsupported", { ua: navigator.userAgent });
      setSupported(false);
    }
    mounted.current = true;
  }, [log]);

  // Listen for environment changes
  const refresh = useCallback(() => setEnv(checkEnv()), []);
  useEffect(() => {
    if (nogate) return;
    window.addEventListener("resize", refresh);
    document.addEventListener("fullscreenchange", refresh);
    document.addEventListener("webkitfullscreenchange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", refresh);
    document.addEventListener("visibilitychange", refresh);
    // Polling fallback: catches any missed events (e.g. browser-level fullscreen
    // exits that don't reliably fire fullscreenchange in all browsers).
    const poll = setInterval(refresh, 1000);
    return () => {
      window.removeEventListener("resize", refresh);
      document.removeEventListener("fullscreenchange", refresh);
      document.removeEventListener("webkitfullscreenchange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(poll);
    };
  }, [nogate, refresh]);

  // Log violations and restorations
  useEffect(() => {
    if (nogate || !mounted.current) return;
    const ok = envOk(env);
    if (prevOk.current && !ok) {
      violationCount.current += 1;
      violationStart.current = performance.now();
      log("environment_violation", {
        ...env,
        width: window.innerWidth,
        height: window.innerHeight,
        violation_index: violationCount.current,
        cumulative_away_ms: Math.round(cumAwayMs.current),
      });
    } else if (!prevOk.current && ok) {
      const away = violationStart.current != null
        ? performance.now() - violationStart.current : 0;
      cumAwayMs.current += away;
      maxAwayMs.current = Math.max(maxAwayMs.current, away);
      violationStart.current = null;
      log("environment_restored", {
        away_ms: Math.round(away),
        violation_count: violationCount.current,
        cumulative_away_ms: Math.round(cumAwayMs.current),
      });
    }
    prevOk.current = ok;
  }, [env, nogate, log]);

  // Summary on unmount
  useEffect(() => {
    return () => {
      if (violationCount.current === 0) return;
      log("environment_summary", {
        n_violations:    violationCount.current,
        total_away_ms:   Math.round(cumAwayMs.current),
        max_away_ms:     Math.round(maxAwayMs.current),
        excessive_pausing: violationCount.current >= 5 || cumAwayMs.current >= 60_000,
      });
    };
  }, [log]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!supported) {
    return (
      <Overlay>
        <Title>Browser not supported</Title>
        <Body>
          Please open this task in an up-to-date version of Chrome, Firefox, or Edge.
        </Body>
      </Overlay>
    );
  }

  if (nogate) return <>{children}</>;

  const ok = envOk(env);

  return (
    <>
      {children}
      {!ok && (
        <Overlay>
          {!env.fine_pointer && (
            <>
              <Title>Mouse or trackpad required</Title>
              <Body>This task requires a mouse or trackpad. Touch-only devices are not supported.</Body>
            </>
          )}
          {env.fine_pointer && !env.big_enough && (
            <>
              <Title>Window too small</Title>
              <Body>
                Please resize your browser window to at least {MIN_WIDTH} × {MIN_HEIGHT} pixels,
                or zoom out (⌘ − / Ctrl −) until this message disappears.
              </Body>
            </>
          )}
          {env.fine_pointer && env.big_enough && !env.fullscreen && (
            <>
              <Title>Fullscreen required</Title>
              <Body>This task must run in fullscreen to proceed.</Body>
              <PrimaryButton
                onClick={async () => {
                  setFsReq(true);
                  try {
                    const el = document.documentElement;
                    const rfs = el.requestFullscreen ?? (el as any).webkitRequestFullscreen;
                    if (rfs) await rfs.call(el);
                  } catch {
                    // user denied — they'll see the overlay again
                  }
                  setFsReq(false);
                }}
              >
                {fsRequesting ? "Requesting…" : "Continue in fullscreen"}
              </PrimaryButton>
            </>
          )}
          {env.fine_pointer && env.big_enough && env.fullscreen && !env.focused && (
            <>
              <Title>Task paused</Title>
              <Body>Please return to this window to continue.</Body>
            </>
          )}
        </Overlay>
      )}
    </>
  );
}
