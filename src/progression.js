/**
 * Progression engine (double progression), ramp-up calculator and PR detection. Pure functions.
 * All weights are kg. For "assisted" exercises, a LOWER number is harder, so direction is reversed.
 */

export const roundTo = (x, step) => (step > 0 ? Math.round(x / step) * step : x);
const clean = (n) => Math.round(n * 100) / 100;
/** Epley estimated one-rep max. */
export const epley = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

const working = (sets) => (sets || []).filter((s) => s.type !== 'warmup' && s.done && !s.skipped && s.reps > 0);

/**
 * Suggest next session's weight from the last session's sets.
 * @param {{equipment:string, incrementKg:number, repMax:number, lastSets:Array}} p
 * @returns {{weightKg:number|null, action:'start'|'increase'|'hold', reason:string}}
 */
export function suggestWeight({ equipment, incrementKg = 2.5, repMax, lastSets }) {
  const w = working(lastSets);
  if (!w.length) return { weightKg: null, action: 'start', reason: 'First time: starting weight from your plan.' };
  const lastW = Math.max(...w.map((s) => s.weightKg || 0));
  const atW = w.filter((s) => (s.weightKg || 0) === lastW);
  const assisted = equipment === 'assisted';
  if (w.some((s) => s.rpe >= 10) || w.some((s) => s.formPoor)) {
    return { weightKg: lastW, action: 'hold', reason: 'Holding the weight: last time hit RPE 10 or form was flagged.' };
  }
  const allTop = atW.length === w.length && atW.every((s) => s.reps >= repMax);
  if (allTop) {
    if (assisted) {
      const nw = Math.max(0, clean(lastW - incrementKg));
      return nw === lastW
        ? { weightKg: lastW, action: 'hold', reason: 'No assistance left. Aim for more reps or try the unassisted bar.' }
        : { weightKg: nw, action: 'increase', reason: `All sets hit ${repMax} reps, so assistance drops by ${incrementKg} kg.` };
    }
    if (equipment === 'bodyweight' && !(incrementKg > 0)) {
      return { weightKg: lastW, action: 'hold', reason: `All sets hit ${repMax} reps. Add reps or a little weight when ready.` };
    }
    return { weightKg: clean(lastW + incrementKg), action: 'increase',
      reason: `All sets hit ${repMax} reps at ${lastW} kg, so +${incrementKg} kg today.` };
  }
  return { weightKg: lastW, action: 'hold',
    reason: `Keep ${lastW} kg and aim for more reps (last: ${w.map((s) => s.reps).join(', ')}).` };
}

/** Number of sets for today after phase and gap rules. */
export function plannedSets(item, phase, phaseRules, gapAdj) {
  const full = item.repsPerSet?.length || item.sets;
  const cap = phaseRules[phase]?.sets;
  let n = cap ? Math.min(full, cap) : full;
  if (gapAdj) {
    if (gapAdj.sets) n = Math.min(n, gapAdj.sets);
    else if (gapAdj.setDelta) n = Math.max(Math.min(full, 2), n + gapAdj.setDelta);
  }
  return Math.max(1, n);
}

/**
 * Today's target for one exercise: sets, reps per set, weight and a one-line reason.
 * Gap rules scale "last time's" load (reversed for assisted); otherwise double progression applies.
 */
export function computeTarget({ item, exercise, lastSets, phase, phaseRules, gapAdj }) {
  const eq = exercise.equipment;
  const step = Math.max(0.5, exercise.incrementKg || 0.5);
  const sets = plannedSets(item, phase, phaseRules, gapAdj);
  const repsPerSet = item.repsPerSet ? item.repsPerSet.slice(0, sets) : null;
  const w = working(lastSets);
  const lastW = w.length ? Math.max(...w.map((s) => s.weightKg || 0)) : null;
  let weightKg, reason;
  if (lastW === null) {
    const pct = (phaseRules[phase]?.weightPct ?? 100) / 100;
    weightKg = eq === 'assisted' || eq === 'bodyweight' ? item.startWeightKg : roundTo(item.startWeightKg * pct, step);
    reason = pct < 1 && eq !== 'assisted' && eq !== 'bodyweight'
      ? `First time, Phase ${phase}: ${Math.round(pct * 100)}% of the ${item.startWeightKg} kg start.`
      : 'First time: starting weight from your plan.';
  } else if (gapAdj) {
    const f = gapAdj.pct / 100;
    weightKg = eq === 'assisted' ? roundTo(lastW / f, step) : roundTo(lastW * f, step);
    reason = `Back after ${gapAdj.gapDays} days: ${gapAdj.pct}% of last time (${lastW} kg).`;
  } else {
    const s = suggestWeight({ equipment: eq, incrementKg: exercise.incrementKg, repMax: item.repMax, lastSets });
    weightKg = s.weightKg; reason = s.reason;
  }
  return { sets, repsPerSet, weightKg: clean(weightKg || 0), reason };
}

/** Ramp-up sets on the day's first exercise: 1 x 10 at ~40% and 1 x 5 at ~70% of working weight. */
export function rampUp(workingKg, equipment) {
  if (!(workingKg > 0) || equipment === 'bodyweight' || equipment === 'assisted') return [];
  return [{ reps: 10, pct: 40, restSec: 45 }, { reps: 5, pct: 70, restSec: 45 }]
    .map((r) => ({ ...r, weightKg: Math.max(0.5, roundTo(workingKg * r.pct / 100, 0.5)) }));
}

/**
 * PR detection for one exercise. `history` = working sets from earlier completed sessions;
 * `current` = this session's. No history means no PR (avoids noise on first use).
 */
export function detectPRs(current, history) {
  const cur = working(current), hist = working(history);
  if (!cur.length || !hist.length) return [];
  const prs = [];
  const maxW = Math.max(...hist.map((s) => s.weightKg || 0));
  const curMaxW = Math.max(...cur.map((s) => s.weightKg || 0));
  if (curMaxW > maxW) prs.push({ type: 'weight', value: curMaxW });
  const bestAt = new Map();
  for (const s of hist) bestAt.set(s.weightKg || 0, Math.max(bestAt.get(s.weightKg || 0) || 0, s.reps));
  for (const s of cur) {
    const b = bestAt.get(s.weightKg || 0);
    if (b !== undefined && s.reps > b && !(s.weightKg > maxW)) {
      prs.push({ type: 'reps', value: s.reps, weightKg: s.weightKg });
      break;
    }
  }
  const vol = (a) => a.reduce((t, s) => t + (s.weightKg || 0) * s.reps, 0);
  const bySession = new Map();
  for (const s of hist) bySession.set(s.sessionId, (bySession.get(s.sessionId) || 0) + (s.weightKg || 0) * s.reps);
  const bestVol = Math.max(...bySession.values());
  if (vol(cur) > bestVol && vol(cur) > 0) prs.push({ type: 'volume', value: Math.round(vol(cur)) });
  return prs;
}
