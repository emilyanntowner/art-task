/**
 * Social Influence Task — jsPsych Timeline
 *
 * Two-phase structure:
 *   Phase 1 (baseline): 50 artwork ratings, no agent info shown.
 *   Phase 2 (influence): 50 artwork ratings, each preceded by agent's rating.
 *
 * Trial structure per Phase 2 trial:
 *   1. Artwork + agent rating reveal (4 s)
 *   2. Re-rating: participant rates on 0-100 slider (self-paced, <=8 s)
 *   3. ITI: fixation cross (2-4 s jittered)
 *
 * Phase 1 trials use the same slider, no reveal step.
 */

import type { JsPsych } from "jspsych";
import HtmlButtonResponse from "@jspsych/plugin-html-button-response";
import HtmlSliderResponse from "@jspsych/plugin-html-slider-response";
import HtmlKeyboardResponse from "@jspsych/plugin-html-keyboard-response";
import {
  createBlock,
  submitRating,
  postEvent,
  type Trial,
  type Mode,
} from "./api";

// ── Context ───────────────────────────────────────────────────────────────────

export type TaskContext = {
  sessionId: string;
  token: string;
  mode: Mode;
  trials: Trial[];
  revealDurationMs?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function logEvent(
  ctx: TaskContext,
  type: string,
  payload?: Record<string, unknown>,
  blockId?: string,
) {
  postEvent(ctx.sessionId, ctx.token, { type, block_id: blockId, payload })
    .catch((err) => console.error(`[timeline] failed to log ${type}`, err));
}


// Artwork is position:fixed so its viewport position is identical across
// initial-rating, reveal, and re-rating phases regardless of jsPsych's
// internal layout differences between HtmlSliderResponse / HtmlKeyboardResponse.
const ARTWORK_TOP    = "7rem";    // distance from viewport top
const ARTWORK_ZONE_H = "330px";   // height of the fixed artwork zone

function artworkContainerHtml(trial: Trial): string {
  const inner = trial.image_url
    ? `<div style="width:590px;max-width:94vw;height:315px;border-radius:4px;
                  display:flex;align-items:center;justify-content:center;">
         <img src="${trial.image_url}" alt="${trial.title}"
              style="width:100%;height:100%;object-fit:contain;border-radius:4px;display:block;">
       </div>`
    : `<div style="width:580px;max-width:94vw;height:360px;background:#f1f5f9;border:1px solid #e2e8f0;
                  border-radius:4px;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;color:#94a3b8;">
         <div style="font-size:2.5rem;margin-bottom:0.5rem;">🖼</div>
         <div style="font-size:14px;">${trial.title}</div>
         <div style="font-size:12px;margin-top:4px;">${trial.artist}, ${trial.year}</div>
       </div>`;
  return `
    <div style="position:fixed;top:${ARTWORK_TOP};left:50%;transform:translateX(-50%);
                width:min(680px,94vw);height:${ARTWORK_ZONE_H};
                display:flex;align-items:center;justify-content:center;
                pointer-events:none;z-index:1;">
      ${inner}
    </div>
    <div style="height:calc(${ARTWORK_TOP} + ${ARTWORK_ZONE_H});"></div>
  `;
}

function ratingStimulus(trial: Trial): string {
  return `
    <div style="max-width:54rem;margin:0 auto;text-align:center;">
      ${artworkContainerHtml(trial)}
      <p style="font-size:1rem;color:#475569;margin:0.1rem 0 0.4rem;">
        How much do you like this artwork?
      </p>
    </div>
  `;
}

function avatarHtml(name: string, code: string): string {
  return `
    <div style="text-align:center;">
      <div style="width:210px;height:210px;border-radius:50%;overflow:hidden;
                  margin:0 auto 0.6rem;border:2px solid #cbd5e1;background:#e2e8f0;">
        <img src="/avatars/${code}.png" alt="${name}"
             style="width:100%;height:100%;object-fit:cover;"
             onerror="this.style.display='none';this.parentElement.innerHTML+='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2.8rem;color:#94a3b8;\\'>👤</div>'">
      </div>
      <div style="font-size:1.05rem;font-weight:600;color:#334155;">${name}</div>
    </div>
  `;
}

function agentPairRevealHtml(
  agent1: string, agent1Code: string,
  agent2: string, agent2Code: string,
  avgRating: number,
): string {
  // Randomise left/right display order
  const agent1First = Math.random() < 0.5;
  const [leftName, leftCode, rightName, rightCode] = agent1First
    ? [agent1, agent1Code, agent2, agent2Code]
    : [agent2, agent2Code, agent1, agent1Code];

  return `
    <div class="si-fade-in">
      <div style="display:flex;gap:3.5rem;justify-content:center;margin:1rem 0 1.25rem;">
        ${avatarHtml(leftName, leftCode)}
        ${avatarHtml(rightName, rightCode)}
      </div>
      <div style="text-align:center;font-size:1.05rem;color:#475569;">
        The average of <strong>${leftName}</strong> and <strong>${rightName}</strong>'s rating is
        <span style="font-size:2.2rem;font-weight:700;color:#1e293b;margin-left:0.3rem;">${avgRating}</span>
        <span style="font-size:0.9rem;color:#94a3b8;"> / 100</span>
      </div>
    </div>
  `;
}

function addSliderValueDisplay() {
  const slider = document.querySelector('input[type="range"]') as HTMLInputElement | null;
  if (!slider) return;
  const display = document.createElement('div');
  display.style.cssText = 'text-align:center;font-size:2rem;font-weight:600;color:#1e293b;margin:0.4rem 0 0.1rem;min-height:2.5rem;';
  display.textContent = slider.value;
  slider.parentNode!.insertBefore(display, slider.nextSibling);
  slider.addEventListener('input', () => { display.textContent = slider.value; });
}

function addScreenOverlays(trialIndex: number, total: number, durationMs = 0, showTimer = true) {
  const container = document.querySelector('.jspsych-display-element') || document.body;

  // Remove stale overlays from previous trial
  document.getElementById('si-progress-counter')?.remove();
  document.getElementById('si-countdown-timer')?.remove();

  // Progress counter — top right
  const progress = document.createElement('div');
  progress.id = 'si-progress-counter';
  progress.style.cssText = 'position:fixed;top:1rem;right:1.5rem;font-size:0.85rem;color:#94a3b8;z-index:100;';
  progress.textContent = `${trialIndex + 1} / ${total}`;
  container.appendChild(progress);

  if (!showTimer) return;

  // Countdown timer — top left
  const timer = document.createElement('div');
  timer.id = 'si-countdown-timer';
  timer.style.cssText = 'position:fixed;top:1rem;left:1.5rem;font-size:0.85rem;color:#94a3b8;z-index:100;';
  const t0 = performance.now();
  timer.textContent = `${Math.ceil(durationMs / 1000)}s`;
  const id = setInterval(() => {
    const s = Math.max(0, Math.ceil((durationMs - (performance.now() - t0)) / 1000));
    timer.textContent = `${s}s`;
    if (s <= 0) clearInterval(id);
  }, 250);
  setTimeout(() => clearInterval(id), durationMs + 500);
  container.appendChild(timer);
}

// ── Response quality tracking ─────────────────────────────────────────────────

type ResponseData = {
  initialRatings: number[];
  rerateRatings:  number[];
  initialRTs:     number[];
  rerateRTs:      number[];
  taskStartMs:    number | null;
};

// Minimum ms a participant must view the artwork before submitting initial rating
const MIN_VIEW_MS = 1000;

// ── Trials (rate → reveal → re-rate → ITI) ───────────────────────────────────

function buildTrials(ctx: TaskContext, blockId: string, _jsPsych: JsPsych, responseData: ResponseData) {
  const revealMs = ctx.revealDurationMs ?? 5000;

  return ctx.trials.flatMap((trial) => {
    let artworkOnsetMs: number | null = null;
    let rerateOnsetMs: number | null = null;
    let initialRatingValue: number = 50;

    const initialRatingTrial = {
      type: HtmlSliderResponse,
      stimulus: ratingStimulus(trial),
      labels: ["0<br>Not at all", "100<br>Extremely"],
      min: 0,
      max: 100,
      slider_start: 50,
      button_label: "Submit",
      on_load: () => {
        addSliderValueDisplay();
        addScreenOverlays(trial.trial_index, ctx.trials.length, 0, false);
        // Submit locked until: MIN_VIEW_MS elapsed AND slider moved
        const btn = document.querySelector('button.jspsych-btn') as HTMLButtonElement | null;
        const slider = document.querySelector('input[type="range"]') as HTMLInputElement | null;
        if (btn && slider) {
          btn.disabled = true;
          btn.style.cssText += ';opacity:0.4;cursor:not-allowed;';
          let timeUp = false;
          let moved  = false;
          const tryEnable = () => {
            if (timeUp && moved) {
              btn.disabled = false;
              btn.style.opacity = '';
              btn.style.cursor  = '';
            }
          };
          setTimeout(() => { timeUp = true; tryEnable(); }, MIN_VIEW_MS);
          slider.addEventListener('input', () => { moved = true; tryEnable(); }, { once: true });
        }
      },
      on_start: () => {
        artworkOnsetMs = performance.now();
        logEvent(ctx, "initial_rating_onset", { artwork_id: trial.artwork_id, trial_index: trial.trial_index }, blockId);
      },
      on_finish: async (data: { response: number; rt: number }) => {
        initialRatingValue = data.response;
        responseData.initialRatings.push(data.response);
        responseData.initialRTs.push(data.rt);
        logEvent(ctx, "initial_rating_response", {
          artwork_id: trial.artwork_id,
          rating: data.response,
          rt_ms: data.rt,
          trial_index: trial.trial_index,
        }, blockId);
        await submitRating(ctx.sessionId, ctx.token, blockId, {
          artwork_id: trial.artwork_id,
          rating: data.response,
          rating_type: "initial",
          artwork_onset_ms: artworkOnsetMs ?? undefined,
          rating_rt_ms: data.rt,
          trial_index: trial.trial_index,
        }).catch(console.error);
      },
    };

    const revealTrial = {
      type: HtmlKeyboardResponse,
      stimulus: `
        <div style="max-width:54rem;margin:0 auto;text-align:center;">
          ${artworkContainerHtml(trial)}
          ${agentPairRevealHtml(trial.agent1, trial.agent1_code, trial.agent2, trial.agent2_code, trial.avg_rating)}
        </div>
      `,
      choices: "NO_KEYS" as const,
      trial_duration: revealMs,
      on_load: () => addScreenOverlays(trial.trial_index, ctx.trials.length, revealMs, false),
      on_start: () => {
        logEvent(ctx, "reveal_onset", {
          artwork_id: trial.artwork_id,
          pair_condition: trial.pair_condition,
          agent1: trial.agent1,
          agent2: trial.agent2,
          avg_rating: trial.avg_rating,
          trial_index: trial.trial_index,
        }, blockId);
      },
      on_finish: () => {
        logEvent(ctx, "reveal_end", { artwork_id: trial.artwork_id }, blockId);
      },
    };

    const reratingTrial = {
      type: HtmlSliderResponse,
      stimulus: ratingStimulus(trial),
      labels: ["0<br>Not at all", "100<br>Extremely"],
      min: 0,
      max: 100,
      slider_start: 50,
      button_label: "Submit",
      on_load: () => {
        const slider = document.querySelector('input[type="range"]') as HTMLInputElement | null;
        if (slider) {
          slider.value = String(Math.round(initialRatingValue));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
        addSliderValueDisplay();
        addScreenOverlays(trial.trial_index, ctx.trials.length, 0, false);

        // Disable Submit until participant explicitly interacts with the slider
        // (either moves it or clicks to confirm the pre-filled value)
        const btn = document.querySelector('button.jspsych-btn') as HTMLButtonElement | null;
        if (btn && slider) {
          btn.disabled = true;
          btn.style.cssText += ';opacity:0.4;cursor:not-allowed;';
          const enable = () => {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
            slider.removeEventListener('input', enable);
            slider.removeEventListener('mousedown', enable);
          };
          slider.addEventListener('input', enable);
          slider.addEventListener('mousedown', enable);
        }
      },
      on_start: () => { rerateOnsetMs = performance.now(); },
      on_finish: async (data: { response: number; rt: number }) => {
        responseData.rerateRatings.push(data.response);
        responseData.rerateRTs.push(data.rt);
        logEvent(ctx, "rerate_response", {
          artwork_id: trial.artwork_id,
          rating: data.response,
          pair_condition: trial.pair_condition,
          agent1: trial.agent1,
          agent2: trial.agent2,
          avg_rating: trial.avg_rating,
          rt_ms: data.rt,
          trial_index: trial.trial_index,
        }, blockId);
        await submitRating(ctx.sessionId, ctx.token, blockId, {
          artwork_id: trial.artwork_id,
          rating: data.response,
          rating_type: "rerate",
          pair_condition: trial.pair_condition,
          agent1_condition: trial.agent1_code,
          agent2_condition: trial.agent2_code,
          agent1_rating: trial.agent1_rating,
          agent2_rating: trial.agent2_rating,
          avg_rating: trial.avg_rating,
          artwork_onset_ms: rerateOnsetMs ?? undefined,
          rating_rt_ms: data.rt,
          trial_index: trial.trial_index,
        }).catch(console.error);
      },
    };

    const blankScreen = {
      type: HtmlKeyboardResponse,
      stimulus: "",
      choices: "NO_KEYS" as const,
      trial_duration: 500,
    };

    return [initialRatingTrial, revealTrial, reratingTrial, blankScreen];
  });
}

// ── Full Timeline Builder ─────────────────────────────────────────────────────

function computeQualitySummary(d: ResponseData): Record<string, unknown> {
  const n = d.initialRatings.length;
  if (n === 0) return { n_trials: 0 };

  const mean = d.initialRatings.reduce((a, b) => a + b, 0) / n;
  const sd   = Math.sqrt(d.initialRatings.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const min  = Math.min(...d.initialRatings);
  const max  = Math.max(...d.initialRatings);

  const sortedRTs = [...d.initialRTs].sort((a, b) => a - b);
  const medianRT  = sortedRTs[Math.floor(n / 2)];

  const fastFrac        = d.initialRTs.filter(rt => rt < MIN_VIEW_MS + 200).length / n;
  const signedDeltas    = d.rerateRatings.map((r, i) => r - d.initialRatings[i]);
  const absDeltas       = signedDeltas.map(Math.abs);
  const meanAbsDelta    = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
  const nearZeroDeltaFrac = absDeltas.filter(d => d < 5).length / absDeltas.length;

  // Extreme ratings: fraction of initial ratings at the floor (0) or ceiling (100)
  const extremityFrac = d.initialRatings.filter(r => r === 0 || r === 100).length / n;

  // Direction bias: of trials where the participant actually moved, what fraction went up?
  const movedDeltas        = signedDeltas.filter(d => Math.abs(d) >= 5);
  const positiveDeltaFrac  = movedDeltas.length > 0
    ? movedDeltas.filter(d => d > 0).length / movedDeltas.length
    : null;

  const sessionDurationMs = d.taskStartMs != null
    ? Math.round(performance.now() - d.taskStartMs)
    : null;

  const flagged = (
    fastFrac > 0.3 ||
    sd < 8 ||
    nearZeroDeltaFrac > 0.7 ||
    meanAbsDelta < 4 ||
    extremityFrac > 0.3 ||
    (positiveDeltaFrac != null && (positiveDeltaFrac > 0.85 || positiveDeltaFrac < 0.15))
  );

  return {
    n_trials:             n,
    initial_rating_mean:  Math.round(mean * 10) / 10,
    initial_rating_sd:    Math.round(sd   * 10) / 10,
    initial_rating_min:   min,
    initial_rating_max:   max,
    median_initial_rt_ms: Math.round(medianRT),
    fast_trial_frac:      Math.round(fastFrac         * 100) / 100,
    near_zero_delta_frac: Math.round(nearZeroDeltaFrac * 100) / 100,
    mean_abs_delta:       Math.round(meanAbsDelta      * 10)  / 10,
    extremity_frac:       Math.round(extremityFrac     * 100) / 100,
    positive_delta_frac:  positiveDeltaFrac != null ? Math.round(positiveDeltaFrac * 100) / 100 : null,
    session_duration_ms:  sessionDurationMs,
    flagged,
  };
}

export async function buildTimeline(ctx: TaskContext, _jsPsych: JsPsych) {
  const block = await createBlock(ctx.sessionId, ctx.token, 1);
  const responseData: ResponseData = { initialRatings: [], rerateRatings: [], initialRTs: [], rerateRTs: [], taskStartMs: null };
  const trials = buildTrials(ctx, block.block_id, _jsPsych, responseData);

  const instructions = {
    type: HtmlButtonResponse,
    stimulus: `
      <div style="max-width:34rem;margin:0 auto;text-align:left;">
        <h1 style="font-size:1.4rem;font-weight:600;margin-bottom:1rem;text-align:center;">
          Art Task
        </h1>
        <p style="margin-bottom:1rem;">
          You'll see a series of artworks. For each one:
        </p>
        <ol style="padding-left:1.5rem;margin-bottom:1rem;list-style-type:decimal;">
          <li style="margin-bottom:0.6rem;">
            <strong>Rate</strong> how much you like it on a scale from
            <strong>0</strong> (not at all) to <strong>100</strong> (extremely).
          </li>
          <li style="margin-bottom:0.6rem;">
            You'll briefly see <strong>the average rating given by two AI agents</strong>.
            The pair of agents giving feedback will change throughout the task.
          </li>
          <li style="margin-bottom:0.6rem;">
            <strong>Rate it again</strong> — your rating can stay the same or change.
          </li>
        </ol>
        <p style="color:#64748b;font-size:0.9rem;">
          There are no right or wrong answers — go with your honest reaction.
        </p>
      </div>
    `,
    choices: ["Begin"],
    on_load: () => document.body.classList.add("instructions-mode"),
    on_start: () => logEvent(ctx, "instructions_shown"),
    on_finish: () => {
      document.body.classList.remove("instructions-mode");
      logEvent(ctx, "instructions_dismissed");
      logEvent(ctx, "task_start");
      responseData.taskStartMs = performance.now();
    },
  };

  const endScreen = {
    type: HtmlButtonResponse,
    stimulus: `
      <div style="max-width:32rem;margin:0 auto;text-align:center;">
        <h2 style="font-size:1.25rem;font-weight:600;margin-bottom:1rem;">All done — thank you!</h2>
        <p>Your responses have been saved.</p>
      </div>
    `,
    choices: ["Finish"],
    on_start: () => {
      logEvent(ctx, "task_end");
      logEvent(ctx, "response_quality_summary", computeQualitySummary(responseData));
    },
    on_finish: () => logEvent(ctx, "timeline_complete"),
  };

  return [instructions, ...trials, endScreen];
}
