/**
 * API client for the Social Influence Task backend.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

let clientT0: number | null = null;

export function clientSessionMs(): number {
  if (clientT0 === null) {
    throw new Error("clientSessionMs() called before createSession");
  }
  return performance.now() - clientT0;
}

export function resetClientClock(): void {
  clientT0 = null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Mode = "test" | "full";

export type Trial = {
  artwork_id: number;
  title: string;
  artist: string;
  year: number;
  wikiart_url: string;
  image_url: string;
  pair_condition: string;
  agent1: string;
  agent1_code: string;
  agent2: string;
  agent2_code: string;
  offset_magnitude: number;
  offset_sign: number;
  base_offset_index: number;
  trial_index: number;
};

export type CreateSessionResponse = {
  session_id: string;
  session_token: string;
  participant_index: number;
  trials: Trial[];
};

// ── Session ───────────────────────────────────────────────────────────────────

export async function createSession(body: {
  participant_id: string;
  mode: Mode;
  participant_number?: number;
  sc_session_id?: string;
}): Promise<CreateSessionResponse> {
  const result = await json<CreateSessionResponse>(
    await fetch(`${BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  clientT0 = performance.now();
  return result;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

export async function createBlock(
  sessionId: string,
  token: string,
  phase: 1 | 2,
): Promise<{ block_id: string }> {
  return json(
    await fetch(`${BASE}/sessions/${sessionId}/blocks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ phase }),
    }),
  );
}

// ── Ratings ───────────────────────────────────────────────────────────────────

export async function submitRating(
  sessionId: string,
  token: string,
  blockId: string,
  body: {
    artwork_id: number;
    rating: number;
    rating_type?: string;
    pair_condition?: string;
    agent1_condition?: string;
    agent2_condition?: string;
    avg_rating?: number;
    offset_magnitude?: number;
    offset_sign?: number;
    offset_sign_flipped?: boolean;
    base_offset_index?: number;
    artwork_onset_ms?: number;
    rating_rt_ms?: number;
    trial_index?: number;
  },
): Promise<{ rating_id: string }> {
  const t_client_ms = clientSessionMs();
  return json(
    await fetch(`${BASE}/sessions/${sessionId}/blocks/${blockId}/ratings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, t_client_ms }),
    }),
  );
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function postEvent(
  sessionId: string,
  token: string,
  body: {
    type: string;
    block_id?: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ event_id: string; t_ms: number }> {
  const t_client_ms = clientSessionMs();
  return json(
    await fetch(`${BASE}/sessions/${sessionId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, t_client_ms }),
    }),
  );
}

// ── Complete ──────────────────────────────────────────────────────────────────

export async function completeSession(
  sessionId: string,
  token: string,
): Promise<{ prolific_completion_url: string }> {
  return json(
    await fetch(`${BASE}/sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}
