/**
 * App.tsx — dev landing screen for the Social Influence Task.
 *
 * In production (Prolific), main.tsx routes to PilotApp instead.
 * This screen is for local dev testing only.
 */

import { useState, useCallback } from "react";
import TimelineRunner from "./components/TimelineRunner";
import { createSession, completeSession } from "./api";
import type { TaskContext } from "./timeline";


export default function App() {
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await createSession({
        participant_id: "DEV_USER",
        mode: "dev",
      });
      setCtx({
        sessionId: s.session_id,
        token: s.session_token,
        mode: "dev",
        trials: s.trials,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = useCallback(async () => {
    if (!ctx) return;
    await completeSession(ctx.sessionId, ctx.token).catch(console.error);
    setCtx(null);
  }, [ctx]);

  if (ctx) {
    return <TimelineRunner ctx={ctx} onComplete={handleComplete} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Social Influence Task — Dev
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Dev mode — runs all 120 trials with default agent pairs (no Prolific
          ID required). Participant index is always 0 and data is saved to the
          local database. Use <code className="font-mono">?mode=pilot</code> or{" "}
          <code className="font-mono">?mode=full</code> for real study sessions.
        </p>

        <button
          disabled={loading}
          onClick={start}
          className="w-full px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-800 disabled:opacity-50"
        >
          Start dev session
        </button>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
