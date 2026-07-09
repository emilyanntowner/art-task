"""
Art Task — FastAPI Backend

Endpoints:
  POST /sessions                           — create session, assign participant index
  POST /sessions/{id}/blocks               — start a rating block
  POST /sessions/{id}/blocks/{bid}/ratings — submit a single artwork rating
  POST /sessions/{id}/events               — log a jsPsych timeline event
  POST /sessions/{id}/complete             — stamp ended_at, return Prolific URL
  GET  /health                             — health check
"""

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

load_dotenv()

from .db import Base, engine, get_db
from . import models
from .stimuli import build_trials, DEFAULT_PAIRS, get_pairs_for_config
from .pilot import assign_participant_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Social Influence Task — Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5174")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROLIFIC_COMPLETION_URL = os.getenv("PROLIFIC_COMPLETION_URL", "")


# ── Clock ─────────────────────────────────────────────────────────────────────

def session_local_ms(session: models.Session, monotonic_s: float | None = None) -> float:
    if session.monotonic_start_s is None:
        return 0.0
    t = monotonic_s if monotonic_s is not None else time.monotonic()
    return (t - session.monotonic_start_s) * 1000.0


# ── Auth ──────────────────────────────────────────────────────────────────────

def require_session_token(
    session_id: str,
    authorization: str | None = Header(None),
    db: DBSession = Depends(get_db),
) -> models.Session:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing session token")
    token = authorization.removeprefix("Bearer ").strip()
    session = db.get(models.Session, session_id)
    if session is None or session.session_token != token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return session


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateSessionBody(BaseModel):
    participant_id: str
    mode: Literal["test", "full"] = "test"
    participant_number: int | None = None  # 1-24; selects counterbalancing config
    sc_session_id: str | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    session_token: str
    participant_index: int
    trials: list[dict]


class CreateBlockBody(BaseModel):
    phase: int = Field(ge=1, le=2)


class CreateBlockResponse(BaseModel):
    block_id: str


class SubmitRatingBody(BaseModel):
    artwork_id: int
    rating: float = Field(ge=0, le=100)
    rating_type: str | None = None
    pair_condition: str | None = None
    agent1_condition: str | None = None
    agent2_condition: str | None = None
    agent1_rating: float | None = None
    agent2_rating: float | None = None
    avg_rating: float | None = None
    offset_magnitude: float | None = None
    offset_sign: int | None = None
    offset_sign_flipped: bool | None = None
    base_offset_index: int | None = None
    artwork_onset_ms: float | None = None
    rating_rt_ms: float | None = None
    trial_index: int | None = None
    t_client_ms: float | None = None


class SubmitRatingResponse(BaseModel):
    rating_id: str


class LogEventBody(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    block_id: str | None = None
    t_client_ms: float | None = None
    payload: dict | None = None


class LogEventResponse(BaseModel):
    event_id: str
    t_ms: float


class CompleteSessionResponse(BaseModel):
    prolific_completion_url: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sessions", response_model=CreateSessionResponse)
def create_session(body: CreateSessionBody, db: DBSession = Depends(get_db)):
    if body.mode == "full":
        participant_index = assign_participant_index(db)
    else:
        participant_index = 0

    trial_limit = 12 if body.mode == "test" else None

    import json as _json

    cb_index = (body.participant_number - 1) if body.participant_number is not None else participant_index
    pairs = get_pairs_for_config(cb_index)

    trials = build_trials(participant_index, pairs, trial_limit=trial_limit)

    session = models.Session(
        participant_id=body.participant_id,
        mode=body.mode,
        condition_order=f"si_p{participant_index}",
        identity_order=_json.dumps({k: [a["id"] for a in v] for k, v in pairs.items()}),
        sc_session_id=body.sc_session_id,
        monotonic_start_s=time.monotonic(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return CreateSessionResponse(
        session_id=session.id,
        session_token=session.session_token,
        participant_index=participant_index,
        trials=trials,
    )


@app.post("/sessions/{session_id}/blocks", response_model=CreateBlockResponse)
def create_block(
    session_id: str,
    body: CreateBlockBody,
    session: models.Session = Depends(require_session_token),
    db: DBSession = Depends(get_db),
):
    block = models.Block(
        session_id=session.id,
        phase=body.phase,
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return CreateBlockResponse(block_id=block.id)


@app.post(
    "/sessions/{session_id}/blocks/{block_id}/ratings",
    response_model=SubmitRatingResponse,
)
def submit_rating(
    session_id: str,
    block_id: str,
    body: SubmitRatingBody,
    session: models.Session = Depends(require_session_token),
    db: DBSession = Depends(get_db),
):
    block = db.get(models.Block, block_id)
    if block is None or block.session_id != session.id:
        raise HTTPException(status_code=404, detail="Block not found")

    t_ms = body.t_client_ms if body.t_client_ms is not None else session_local_ms(session)

    if (
        body.rating_type == "rerate"
        and body.avg_rating is not None
        and body.offset_sign is not None
        and body.offset_magnitude is not None
    ):
        init_row = (
            db.query(models.Rating)
            .filter(
                models.Rating.block_id == block_id,
                models.Rating.artwork_id == body.artwork_id,
                models.Rating.rating_type == "initial",
            )
            .first()
        )
        if init_row is not None and init_row.rating is not None:
            expected = max(10.0, min(90.0, round(init_row.rating + body.offset_sign * body.offset_magnitude)))
            if abs(expected - body.avg_rating) > 0.5:
                logging.warning(
                    "avg_rating mismatch — participant_id=%s trial_index=%s artwork_id=%s "
                    "initial_rating=%.1f offset_sign=%d offset_magnitude=%.1f "
                    "expected=%.0f submitted=%.1f",
                    session.participant_id,
                    body.trial_index,
                    body.artwork_id,
                    init_row.rating,
                    body.offset_sign,
                    body.offset_magnitude,
                    expected,
                    body.avg_rating,
                )

    rating = models.Rating(
        block_id=block_id,
        artwork_id=body.artwork_id,
        rating=body.rating,
        rating_type=body.rating_type,
        pair_condition=body.pair_condition,
        agent1_condition=body.agent1_condition,
        agent2_condition=body.agent2_condition,
        agent1_rating=body.agent1_rating,
        agent2_rating=body.agent2_rating,
        avg_rating=body.avg_rating,
        offset_magnitude=body.offset_magnitude,
        offset_sign=body.offset_sign,
        offset_sign_flipped=body.offset_sign_flipped,
        base_offset_index=body.base_offset_index,
        artwork_onset_ms=body.artwork_onset_ms,
        rating_rt_ms=body.rating_rt_ms,
        trial_index=body.trial_index,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    return SubmitRatingResponse(rating_id=rating.id)


@app.post("/sessions/{session_id}/events", response_model=LogEventResponse)
def log_event(
    session_id: str,
    body: LogEventBody,
    session: models.Session = Depends(require_session_token),
    db: DBSession = Depends(get_db),
):
    if body.block_id is not None:
        block = db.get(models.Block, body.block_id)
        if block is None or block.session_id != session.id:
            raise HTTPException(status_code=404, detail="Block not found")

    t_ms = body.t_client_ms if body.t_client_ms is not None else session_local_ms(session)
    ev = models.Event(
        session_id=session.id,
        block_id=body.block_id,
        type=body.type,
        t_ms=t_ms,
        t_client_ms=body.t_client_ms,
        payload=body.payload,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return LogEventResponse(event_id=ev.id, t_ms=t_ms)


@app.post("/sessions/{session_id}/complete", response_model=CompleteSessionResponse)
def complete_session(
    session_id: str,
    session: models.Session = Depends(require_session_token),
    db: DBSession = Depends(get_db),
):
    from datetime import datetime, timezone
    session.ended_at = datetime.now(timezone.utc)
    db.commit()
    return CompleteSessionResponse(prolific_completion_url=PROLIFIC_COMPLETION_URL)


# ── Static file serving (production) ─────────────────────────────────────────
# Serve the built Vite frontend. Mounted last so all API routes take priority.
# Not present in local dev (frontend runs on its own Vite dev server).
_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")
