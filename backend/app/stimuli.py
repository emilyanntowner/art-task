"""
Stimuli management for the Social Influence Task.

Avatars are identified by codes: r{race}m{1|2} / r{race}f{1|2}
  e.g. r1m1 = race-group 1, male, individual 1
       r2f2 = race-group 2, female, individual 2

Control avatars are automatically derived: the "other" individual of the same
race and gender (r1m1 ↔ r1m2, r2f1 ↔ r2f2, etc.).

Four pair-conditions per participant:
  friendly          — 2 avatars the participant felt connected to
  neutral           — 2 avatars the participant felt neutral toward
  friendly_control  — race/gender-matched controls for the friendly pair
  neutral_control   — race/gender-matched controls for the neutral pair

Artwork-condition assignment:
  4 conditions, artworks assigned by (artwork_id - 1 + participant_index) mod 4
  Every 4 participants = 1 complete rotation
"""

import json
import random
from pathlib import Path

STIMULI_DIR      = Path(__file__).parent / "stimuli"
ARTWORKS_FILE    = STIMULI_DIR / "artworks.json"
AGENT_RATINGS_FILE = STIMULI_DIR / "agent_ratings.json"
AVATAR_NAMES_FILE  = Path(__file__).parent / "avatar_names.json"
CB_FILE            = Path(__file__).parent / "counterbalancing.json"

CONDITION_TYPES = ["friendly", "neutral", "friendly_control", "neutral_control"]
N_CONDITIONS    = len(CONDITION_TYPES)

# Default pairs (avatar codes) used in dev mode
DEFAULT_PAIRS: dict[str, tuple[str, str]] = {
    "friendly":         ("r1m1", "r2f1"),
    "neutral":          ("r3m1", "r4f1"),
    "friendly_control": ("r1m2", "r2f2"),
    "neutral_control":  ("r3m2", "r4f2"),
}


# ── Loaders ───────────────────────────────────────────────────────────────────

def load_artworks() -> list[dict]:
    return json.loads(ARTWORKS_FILE.read_text())


def load_agent_ratings() -> dict[str, dict[str, int]]:
    if AGENT_RATINGS_FILE.exists():
        return json.loads(AGENT_RATINGS_FILE.read_text())
    return {}


def load_avatar_names() -> dict[str, str]:
    return json.loads(AVATAR_NAMES_FILE.read_text())


def load_counterbalancing() -> list[dict]:
    return json.loads(CB_FILE.read_text())


# ── Avatar helpers ─────────────────────────────────────────────────────────────

def get_control_avatar(code: str) -> str:
    """Return the matched-control avatar for a given code.
    r1m1 → r1m2, r1m2 → r1m1, r2f1 → r2f2, etc.
    """
    return code[:-1] + ("2" if code.endswith("1") else "1")


def resolve_name(code: str, names: dict[str, str]) -> str:
    return names.get(code, code)


def get_pairs_for_rotation(participant_index: int) -> dict[str, tuple[str, str]]:
    table = load_counterbalancing()
    entry = table[participant_index % len(table)]
    return {
        "friendly":         tuple(entry["friendly"]),
        "neutral":          tuple(entry["neutral"]),
        "friendly_control": tuple(entry["friendly_control"]),
        "neutral_control":  tuple(entry["neutral_control"]),
    }


# ── Agent ratings ─────────────────────────────────────────────────────────────

def get_agent_rating(avatar_code: str, artwork_id: int, ratings: dict) -> int:
    avatar_ratings = ratings.get(avatar_code, {})
    rating = avatar_ratings.get(str(artwork_id))
    if rating is not None:
        return int(rating)
    rng = random.Random(hash(avatar_code) + artwork_id)
    return rng.randint(30, 80)


# ── Counterbalancing ──────────────────────────────────────────────────────────

def assign_artworks_to_conditions(participant_index: int) -> dict[str, list[dict]]:
    artworks = load_artworks()
    offset   = participant_index % N_CONDITIONS
    assignment: dict[str, list[dict]] = {c: [] for c in CONDITION_TYPES}
    for artwork in artworks:
        condition_idx = ((artwork["id"] - 1) + offset) % N_CONDITIONS
        assignment[CONDITION_TYPES[condition_idx]].append(artwork)
    return assignment


# ── Trial builder ─────────────────────────────────────────────────────────────

def build_trials(
    participant_index: int,
    pairs: dict[str, tuple[str, str]] | None = None,
    seed: int | None = None,
    trial_limit: int | None = None,
) -> list[dict]:
    if pairs is None:
        pairs = DEFAULT_PAIRS

    names      = load_avatar_names()
    assignment = assign_artworks_to_conditions(participant_index)
    ratings    = load_agent_ratings()

    per_condition: int | None = None
    if trial_limit is not None:
        per_condition = trial_limit // N_CONDITIONS

    trials = []
    for condition, artworks in assignment.items():
        agent1_code, agent2_code = pairs.get(condition, DEFAULT_PAIRS[condition])
        agent1_name = resolve_name(agent1_code, names)
        agent2_name = resolve_name(agent2_code, names)

        if per_condition is not None:
            condition_rng = random.Random(
                (seed if seed is not None else participant_index) + hash(condition)
            )
            artworks = condition_rng.sample(artworks, min(per_condition, len(artworks)))

        for artwork in artworks:
            r1  = get_agent_rating(agent1_code, artwork["id"], ratings)
            r2  = get_agent_rating(agent2_code, artwork["id"], ratings)
            avg = round((r1 + r2) / 2)
            trials.append({
                "artwork_id":     artwork["id"],
                "title":          artwork["title"],
                "artist":         artwork["artist"],
                "year":           artwork["year"],
                "image_url":      artwork.get("image_url", ""),
                "wikiart_url":    artwork.get("wikiart_url", ""),
                "pair_condition": condition,
                "agent1":         agent1_name,
                "agent1_code":    agent1_code,
                "agent2":         agent2_name,
                "agent2_code":    agent2_code,
                "agent1_rating":  r1,
                "agent2_rating":  r2,
                "avg_rating":     avg,
            })

    rng = random.Random(seed if seed is not None else participant_index)
    rng.shuffle(trials)
    for i, t in enumerate(trials):
        t["trial_index"] = i

    return trials
