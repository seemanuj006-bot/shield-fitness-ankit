/** Builds the immutable session snapshot from the editable plan. Pure: no DB access. */
import { computeTarget, rampUp } from './progression.js';
import { heavyCrunchConflict, muscleGroups, backToBackMuscles } from './scheduler.js';

/**
 * @param {object} p
 * @param {object} p.day            day template
 * @param {Object<string,object>} p.exMap   exercises by id
 * @param {object|null} p.warmup    warm-up template for the day
 * @param {object|null} p.cooldown  cooldown template for the day
 * @param {Object<string,Array>} p.history  last completed session's sets per exerciseId
 * @param {{week:number, phase:string}} p.phaseInfo
 * @param {object|null} p.gapAdj
 * @param {object} p.rules          phase rules
 * @param {string} p.date
 * @param {Array} p.sessions        existing sessions (for protections)
 */
export function buildSnapshot({ day, exMap, warmup, cooldown, history, phaseInfo, gapAdj, rules, date, sessions }) {
  const notes = [];
  const conflict = heavyCrunchConflict(date, sessions);
  let heavyCrunch = false;
  let firstLift = null;
  const sections = day.sections.map((sec) => {
    if (!sec.items) return { type: sec.type, durationMin: sec.durationMin };
    const items = [];
    for (let item of sec.items) {
      if (item.kind === 'cardio') { items.push({ ...item }); continue; }
      let downgraded = false;
      if (item.heavyCrunch && conflict && item.lightAlt) {
        item = { ...item, ...item.lightAlt, repsPerSet: null, heavyCrunch: false };
        downgraded = true;
        notes.push('Heavy crunches are not allowed on back-to-back days, so crunches are lighter today.');
      }
      const ex = exMap[item.exerciseId];
      if (!ex) continue;
      if (item.heavyCrunch) heavyCrunch = true;
      const t = computeTarget({ item, exercise: ex, lastSets: history[item.exerciseId] || [],
        phase: gapAdj?.forcePhase || phaseInfo.phase, phaseRules: rules, gapAdj });
      const out = {
        exerciseId: ex.id, name: ex.name, equipment: ex.equipment, muscles: ex.muscles, cues: ex.cues,
        searchQuery: ex.searchQuery, videoUrl: ex.videoUrl || null, pulleyRatio: ex.pulleyRatio || '',
        pinnedNote: ex.pinnedNote || '', incrementKg: ex.incrementKg,
        sets: t.sets, repsPerSet: t.repsPerSet, repMin: item.repMin, repMax: item.repMax,
        restSec: item.restSec, targetWeightKg: t.weightKg, reason: t.reason,
        optional: !!item.optional, note: item.note || '', heavyCrunch: !!item.heavyCrunch, downgraded,
        lastSets: (history[item.exerciseId] || []).filter((s) => s.type !== 'warmup' && s.done)
          .map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
      };
      if (!firstLift && sec.type === 'lifts') firstLift = out;
      items.push(out);
    }
    return { type: sec.type, durationMin: sec.durationMin, items };
  });
  const lifts = sections.filter((s) => s.items).flatMap((s) => s.items).filter((i) => !i.kind);
  const groups = muscleGroups(lifts.flatMap((i) => i.muscles));
  const b2b = backToBackMuscles(groups, date, sessions);
  const ramp = firstLift ? rampUp(firstLift.targetWeightKg, firstLift.equipment) : [];
  return {
    dayId: day.id, dayName: day.name, phase: gapAdj?.forcePhase || phaseInfo.phase, week: phaseInfo.week,
    sections, warmup: warmup ? { blocks: warmup.blocks } : null, cooldown: cooldown ? { blocks: cooldown.blocks } : null,
    rampup: firstLift && ramp.length ? { exerciseId: firstLift.exerciseId, name: firstLift.name, sets: ramp } : null,
    heavyCrunch, muscleGroups: groups, backToBack: b2b, notes,
    estMinutes: day.sections.reduce((t, s) => t + (s.durationMin || 0), 0),
  };
}

/** Ordered runner steps derived from a snapshot (also used to seed the resume position). */
export function buildSteps(snap) {
  const steps = [];
  if (snap.warmup) steps.push({ key: 'warmup', type: 'warmup', title: 'Warm-up', sub: 'About 10 min' });
  if (snap.rampup) steps.push({ key: 'rampup', type: 'rampup', title: `Ramp-up: ${snap.rampup.name}`, sub: '2 light sets' });
  let n = 0;
  for (const sec of snap.sections) for (const item of sec.items || []) {
    steps.push({ key: `ex:${n++}`, type: item.kind === 'cardio' ? 'cardio' : 'exercise', title: item.name, item, sec: sec.type });
  }
  if (snap.cooldown) steps.push({ key: 'cooldown', type: 'cooldown', title: 'Cooldown', sub: 'About 3 min' });
  return steps;
}
