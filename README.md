# Art Task

Artwork rating task measuring susceptibility to social influence. Participants rate each artwork, see the average rating of two named agents, then re-rate. Influence is operationalised as the shift toward the agents' average, normalised by the maximum possible shift.

Runs **after** the chat task in the same lab session. Part of the Social Connection study (Mobbs Lab, Caltech).

- **Live app:** https://test-social-influence-task.fly.dev
- **Deployment:** Fly.io (`test-social-influence-task`, org `mobbs-lab`)
- **Stack:** React 19 / jsPsych 8 / Vite / TypeScript frontend · FastAPI + SQLAlchemy + SQLite backend

---

---

## Task Design

**Trial structure** (per artwork, self-paced):
1. **Initial rating** — participant rates artwork on 0–100 slider; Submit locked for ≥ 1 s AND until slider is moved
2. **Feedback reveal** — artwork shown with two agent avatars and their average rating (5 s auto-advance); avatars fade in smoothly
3. **Re-rating** — participant re-rates; Submit locked until slider is moved or clicked
4. **Blank ITI** — 500 ms

**Visual design notes:**
- Artwork is `position:fixed` at a consistent viewport position across all three phases so it never shifts between initial rating, reveal, and re-rating
- All artworks render in a standardised 580×360 px box (`object-fit:contain`) so painting sizes are uniform across trials
- Agent avatars are 210 px circles
- Trial order is randomly shuffled, seeded by participant number (reproducible per config)

**Agent feedback (avg_rating)**

The average shown to the participant is computed relative to their own initial rating:
```
avg_rating = clip(initial_rating + sign × magnitude, 10, 90)
```
- `magnitude` is drawn from uniform(20, 35) for 27 of the 30 trials per condition, and uniform(1, 10) for the remaining **3 close-agreement trials** (where the agents' rating lands within ~10 pts of the participant's own)
- `sign` is +1 or −1; exactly 15 of each per condition
- If the offset would push avg_rating outside [10, 90], the sign is flipped inward (`offset_sign_flipped = true`)
- `avg_rating` is always in [10, 90]

Both the magnitude and base sign are fixed at session creation (seeded by participant index), so the manipulation strength is identical across all 4 conditions by construction.

**4 pair-conditions** (30 artworks each, 120 total):

| Condition | Agents |
|---|---|
| `friendly` | The 2 agents the participant chatted with in the friendly condition |
| `neutral` | The 2 agents the participant chatted with in the neutral condition |
| `friendly_control` | Same race + gender, never chatted with — matched to friendly pair |
| `neutral_control` | Same race + gender, never chatted with — matched to neutral pair |

Conditions are **interspersed** (randomly shuffled across the 120 trials).

**Counterbalancing (24 configs)**

Each config assigns one of the 16 named avatars (4 races × 2 genders × 2 exemplars) to each of 4 roles: friendly-male, friendly-female, neutral-male, neutral-female. All 4 are different races. Controls are the other exemplar of the same race and gender.

- 24 configs = 4! permutations of {r1, r2, r3, r4} across the 4 roles
- Every avatar appears as a social agent in exactly 6/24 configs and as a control in exactly 6/24
- Config is selected by participant number (1–24); cycles for larger samples

**Influence score** (computed at analysis time):
```
Δ = rerate − initial_rating
normalised_influence = Δ / |avg_rating − initial_rating|
```
0 = no influence, 1 = full conformity, negative = contrast. NULL when initial rating equals avg_rating (rare given [10, 90] bounds and non-zero magnitudes).

> **Note on close-agreement trials:** The 3 close-agreement trials per condition have magnitudes of 1–10, so the denominator `|avg_rating − initial_rating|` is small and `norm_influence` will be large even for modest re-rating shifts. Recommend excluding or analysing these trials separately.

---

## Avatars

16 named avatars — balanced 4 races × 2 genders × 2 exemplars:

| | Female | Male |
|---|---|---|
| **r1 — white** | quinn, reese | alex, jordan |
| **r2 — east Asian** | jamie, parker | charlie, logan |
| **r3 — S. Asian / Hispanic** | morgan, taylor | casey, elliot |
| **r4 — black** | rowan, sam | blake, cameron |

Images live in `frontend/public/avatars/{id}.png` (e.g. `r1_m_alex.png`) and are served at `/avatars/{id}.png`.

---

## Running Locally

**Backend** (port 8001):
```bash
cd backend
cp .env.example .env
uv run uvicorn app.main:app --reload --port 8001
```

**Frontend** (port 5174):
```bash
cd frontend
echo "VITE_API_BASE=http://localhost:8001" > .env.local
npm install
npm run dev
```

Open **http://localhost:5174** — the landing page has Test / Full study mode and In-person / Online start buttons.

Port 5174 avoids conflict with the chat task on 5173.

---

## Modes

| Mode | Trials | Use |
|---|---|---|
| `test` | 12 (3 per condition) | Setup, piloting, researcher checks |
| `full` | 120 (30 per condition) | Real data collection |

Mode is selected on the landing page and does not affect trial structure — only trial count.

---

## Entry Points

**Landing page** (`/`) — shown when no `PROLIFIC_PID` in the URL. Researcher selects Test/Full mode and enters participant number (1–24) for in-person or online launch.

**Prolific / online** (`/?PROLIFIC_PID=...`) — detected automatically; goes straight into the task using the auto-incremented participant index for counterbalancing.

Prolific study URL format:
```
https://test-social-influence-task.fly.dev/?PROLIFIC_PID={{%PROLIFIC_PID%}}
```

---

## Deployment

```bash
fly deploy --app test-social-influence-task
```

SQLite DB persists on a Fly volume (`/data/social_influence.db`). **Never scale to more than one machine** — each machine gets its own volume.

---

## Repository Structure

```
art-task/
├── backend/
│   └── app/
│       ├── main.py                  # FastAPI routes
│       ├── models.py                # ORM: Session, Block, Rating, Event
│       ├── db.py                    # DB engine / session factory
│       ├── stimuli.py               # Trial builder, counterbalancing lookup
│       ├── pilot.py                 # Participant index counter
│       ├── counterbalancing.json    # 24-config avatar assignment table
│       └── stimuli/
│           ├── artworks.json        # 120 artwork definitions + image URLs
│           └── agent_ratings.json   # Legacy file — not used (ratings are participant-relative)
├── scripts/
│   └── dump_session.py              # Diagnostic: dump + verify a session's trial data as CSV
├── frontend/
│   ├── tailwind.config.js           # Tailwind content paths
│   ├── postcss.config.js            # PostCSS / Tailwind wiring
│   └── src/
│       ├── main.tsx                 # Entry: routes to LandingFlow or PilotApp
│       ├── LandingFlow.tsx          # Researcher landing page
│       ├── PilotApp.tsx             # Prolific / online flow
│       ├── timeline.ts              # jsPsych trial sequence
│       ├── index.css                # Global styles + jsPsych overrides
│       ├── api.ts                   # API client
│       └── components/
│           ├── TimelineRunner.tsx
│           └── EnvironmentGate.tsx  # Environment checks + violation telemetry
│   └── public/
│       └── avatars/                 # 16 avatar PNGs (r{race}_{gender}_{name}.png)
└── Dockerfile
```

---

## Data Quality & Safeguards

### Environment Gate

Checked continuously throughout the task. Any failure shows a blocking overlay; the task cannot proceed until resolved.

| Check | Condition enforced |
|---|---|
| Fine pointer | `(any-pointer: fine)` — blocks touch-only devices (phones, tablets without mouse) |
| Viewport size | ≥ 1280 × 700 px |
| Fullscreen | Must enter fullscreen; overlay includes "Continue in fullscreen" button |
| Window focus | Pauses task if participant switches windows or tabs |
| Browser support | Requires `fetch`, `AbortController`, `Promise` — blocks obsolete browsers |

Dev bypass: append `?nogate` to the URL.

### In-task Behavioral Safeguard

The initial rating Submit button is locked for **1 second minimum AND until the slider is moved.** Prevents click-through without viewing the artwork.

### Telemetry Events

All events are stored in the `events` table and queryable by `session_id`.

**Environment events:**

| Event type | Key payload fields |
|---|---|
| `environment_violation` | `fine_pointer`, `big_enough`, `fullscreen`, `focused`, `width`, `height`, `violation_index`, `cumulative_away_ms` |
| `environment_restored` | `away_ms`, `violation_count`, `cumulative_away_ms` |
| `environment_summary` | `n_violations`, `total_away_ms`, `max_away_ms`, `excessive_pausing` |
| `browser_unsupported` | `ua` |

`excessive_pausing` is `true` when `n_violations ≥ 5` OR `total_away_ms ≥ 60,000`.

**Session-level quality summary** (`response_quality_summary`) — fired once at the end of the task:

| Field | Flag threshold | What it detects |
|---|---|---|
| `fast_trial_frac` | > 0.30 | Rushing — > 30% of trials submitted in < 1.2 s |
| `initial_rating_sd` | < 8 | Straight-lining — very narrow rating range |
| `near_zero_delta_frac` | > 0.70 | Not engaging with feedback — > 70% of re-ratings within 5 pts of initial |
| `mean_abs_delta` | < 4 | Never really changing re-ratings |
| `extremity_frac` | > 0.30 | Floor/ceiling anchoring — > 30% of initial ratings at exactly 0 or 100 |
| `positive_delta_frac` | > 0.85 or < 0.15 | Always conforming or always contrasting (of trials with ≥ 5 pt move) |
| `session_duration_ms` | — | Total task time in ms; no threshold, use for session-level outlier detection |
| `flagged` | — | `true` if any of the above thresholds exceeded |

**Analysis query to pull quality flags:**
```sql
SELECT
  s.participant_id,
  e.payload->>'flagged'               AS flagged,
  e.payload->>'fast_trial_frac'       AS fast_trial_frac,
  e.payload->>'initial_rating_sd'     AS rating_sd,
  e.payload->>'near_zero_delta_frac'  AS near_zero_delta_frac,
  e.payload->>'extremity_frac'        AS extremity_frac,
  e.payload->>'positive_delta_frac'   AS positive_delta_frac,
  e.payload->>'session_duration_ms'   AS session_duration_ms,
  env.payload->>'excessive_pausing'   AS excessive_pausing,
  env.payload->>'total_away_ms'       AS total_away_ms
FROM events e
JOIN sessions s ON e.session_id = s.id
LEFT JOIN events env ON env.session_id = s.id AND env.type = 'environment_summary'
WHERE e.type = 'response_quality_summary'
ORDER BY s.participant_id;
```

---

## Data Schema

**`sessions`**

| Column | Description |
|---|---|
| `participant_id` | Prolific PID or `P{n}` for in-person |
| `mode` | `test` or `full` |
| `condition_order` | `si_p{index}` |
| `identity_order` | JSON: condition → [agent1_id, agent2_id] for all 4 pairs |
| `sc_session_id` | Chat task session ID for cross-task linkage (when available) |

**`ratings`** — two rows per artwork per participant

| Column | Initial | Re-rating |
|---|---|---|
| `rating_type` | `"initial"` | `"rerate"` |
| `rating` | participant's rating | participant's re-rating |
| `pair_condition` | null | `friendly` / `neutral` / `friendly_control` / `neutral_control` |
| `agent1_condition` | null | agent 1 avatar ID |
| `agent2_condition` | null | agent 2 avatar ID |
| `avg_rating` | null | average shown to participant (always in [10, 90]) |
| `offset_magnitude` | null | magnitude of the offset applied (1–10 close, 20–35 far) |
| `offset_sign` | null | delivered sign (+1 / −1; may differ from assigned if flipped) |
| `offset_sign_flipped` | null | `true` if sign was flipped inward to stay within [10, 90] |
| `base_offset_index` | null | index into participant's base offset set (0–29); for audit |
| `rating_rt_ms` | RT from screen onset to submit | same |
| `trial_index` | position in randomised order | same |

**Core analysis query:**
```sql
SELECT
  s.participant_id,
  s.identity_order,
  i.artwork_id,
  i.trial_index,
  i.rating                                        AS initial_rating,
  i.rating_rt_ms                                  AS initial_rt_ms,
  r.rating                                        AS rerate,
  r.rating_rt_ms                                  AS rerate_rt_ms,
  r.pair_condition,
  r.agent1_condition,
  r.agent2_condition,
  r.avg_rating,
  (r.rating - i.rating)                           AS delta,
  (r.rating - i.rating)
    / NULLIF(ABS(r.avg_rating - i.rating), 0)     AS norm_influence
FROM ratings i
JOIN ratings r  ON i.block_id = r.block_id
                AND i.artwork_id = r.artwork_id
                AND i.rating_type = 'initial'
                AND r.rating_type = 'rerate'
JOIN blocks b   ON i.block_id = b.id
JOIN sessions s ON b.session_id = s.id
ORDER BY s.participant_id, i.trial_index;
```
