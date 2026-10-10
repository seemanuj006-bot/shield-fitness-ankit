import assert from 'node:assert/strict';
import * as P from '../src/progression.js';
import { DEFAULT_PHASE_RULES as R, gapAdjustment } from '../src/scheduler.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok -', name); };
const sets = (w, reps, extra = {}) => reps.map((r) => ({ type: 'working', done: true, weightKg: w, reps: r, ...extra }));

t('double progression: all top reps -> smallest increment', () => {
  const r = P.suggestWeight({ equipment: 'machine', incrementKg: 2.5, repMax: 10, lastSets: sets(30, [10, 10, 10, 10]) });
  assert.equal(r.weightKg, 32.5); assert.equal(r.action, 'increase');
});
t('otherwise hold the weight and chase reps', () => {
  const r = P.suggestWeight({ equipment: 'machine', incrementKg: 2.5, repMax: 10, lastSets: sets(30, [10, 9, 8]) });
  assert.equal(r.weightKg, 30); assert.equal(r.action, 'hold');
  assert.match(r.reason, /10, 9, 8|9/);
});
t('RPE 10 or poor form holds even when reps are at the top', () => {
  assert.equal(P.suggestWeight({ equipment: 'machine', incrementKg: 2.5, repMax: 10, lastSets: sets(30, [10, 10, 10]).map((s, i) => i === 2 ? { ...s, rpe: 10 } : s) }).action, 'hold');
  assert.equal(P.suggestWeight({ equipment: 'dumbbell', incrementKg: 1, repMax: 10, lastSets: sets(8, [10, 10], { formPoor: true }) }).weightKg, 8);
});
t('assisted pull-up: less assistance = progress (reversed direction)', () => {
  const r = P.suggestWeight({ equipment: 'assisted', incrementKg: 2.5, repMax: 8, lastSets: sets(30, [8, 8, 8]) });
  assert.equal(r.weightKg, 27.5); assert.equal(r.action, 'increase');
  assert.equal(P.suggestWeight({ equipment: 'assisted', incrementKg: 2.5, repMax: 8, lastSets: sets(1, [8, 8]) }).weightKg, 0);
  assert.equal(P.suggestWeight({ equipment: 'assisted', incrementKg: 2.5, repMax: 8, lastSets: sets(0, [8, 8]) }).action, 'hold');
  assert.equal(P.suggestWeight({ equipment: 'assisted', incrementKg: 2.5, repMax: 8, lastSets: sets(30, [8, 6, 6]) }).weightKg, 30);
});
t('warm-up, skipped and undone sets are ignored', () => {
  const last = [...sets(30, [10, 10, 10]), { type: 'warmup', done: true, weightKg: 10, reps: 10 }, { type: 'working', done: false, weightKg: 30, reps: 3 }];
  assert.equal(P.suggestWeight({ equipment: 'machine', incrementKg: 2.5, repMax: 10, lastSets: last }).weightKg, 32.5);
  assert.equal(P.suggestWeight({ equipment: 'machine', incrementKg: 2.5, repMax: 10, lastSets: [] }).action, 'start');
});
t('first-time targets follow phase rules (A = 2 sets at 60%)', () => {
  const item = { sets: 4, repMin: 12, repMax: 15, startWeightKg: 20 };
  const ex = { equipment: 'machine', incrementKg: 2.5 };
  const a = P.computeTarget({ item, exercise: ex, lastSets: [], phase: 'A', phaseRules: R, gapAdj: null });
  assert.equal(a.sets, 2); assert.equal(a.weightKg, 12.5);
  assert.equal(P.computeTarget({ item, exercise: ex, lastSets: [], phase: 'B', phaseRules: R, gapAdj: null }).sets, 3);
  const c = P.computeTarget({ item, exercise: ex, lastSets: [], phase: 'C', phaseRules: R, gapAdj: null });
  assert.equal(c.sets, 4); assert.equal(c.weightKg, 20);
});
t('crunch 15,15,15,8 pattern is trimmed by phase', () => {
  const item = { sets: 4, repsPerSet: [15, 15, 15, 8], repMin: 15, repMax: 15, startWeightKg: 50 };
  const r = P.computeTarget({ item, exercise: { equipment: 'cable', incrementKg: 2.5 }, lastSets: [], phase: 'B', phaseRules: R, gapAdj: null });
  assert.deepEqual(r.repsPerSet, [15, 15, 15]);
});
t('gap rules scale last weight and sets (reversed for assisted)', () => {
  const item = { sets: 3, repMin: 10, repMax: 10, startWeightKg: 30 };
  const ex = { equipment: 'machine', incrementKg: 2.5 };
  const last = sets(40, [10, 10, 10]);
  const g3 = P.computeTarget({ item, exercise: ex, lastSets: last, phase: 'C', phaseRules: R, gapAdj: gapAdjustment(4) });
  assert.equal(g3.weightKg, 35); assert.equal(g3.sets, 2);
  const g7 = P.computeTarget({ item: { ...item, sets: 4 }, exercise: ex, lastSets: last, phase: 'C', phaseRules: R, gapAdj: gapAdjustment(8) });
  assert.equal(g7.weightKg, 32.5); assert.equal(g7.sets, 2);
  const g14 = P.computeTarget({ item, exercise: ex, lastSets: last, phase: 'C', phaseRules: R, gapAdj: gapAdjustment(20) });
  assert.equal(g14.weightKg, 27.5); assert.equal(g14.sets, 2);
  const as = P.computeTarget({ item: { ...item, sets: 3 }, exercise: { equipment: 'assisted', incrementKg: 2.5 }, lastSets: sets(20, [8, 8, 8]), phase: 'C', phaseRules: R, gapAdj: gapAdjustment(8) });
  assert.equal(as.weightKg, 25, 'more assistance after a break');
});
t('ramp-up weights are 40% and 70% rounded to 0.5 kg', () => {
  const r = P.rampUp(20, 'dumbbell');
  assert.deepEqual(r.map((x) => [x.reps, x.weightKg]), [[10, 8], [5, 14]]);
  assert.deepEqual(P.rampUp(9, 'dumbbell').map((x) => x.weightKg), [3.5, 6.5]);
  assert.deepEqual(P.rampUp(30, 'assisted'), []);
  assert.deepEqual(P.rampUp(0, 'machine'), []);
});
t('Epley and rounding', () => {
  assert.equal(Math.round(P.epley(60, 10) * 10) / 10, 80);
  assert.equal(P.epley(60, 1), 60);
  assert.equal(P.roundTo(12, 2.5), 12.5);
});
t('PR detection: weight, rep at weight, volume; none on first use', () => {
  const hist = sets(30, [10, 9, 8]).map((s) => ({ ...s, sessionId: 'a' }));
  assert.deepEqual(P.detectPRs(sets(30, [10, 9, 8]), []), []);
  assert.ok(P.detectPRs(sets(32.5, [8, 8]), hist).some((p) => p.type === 'weight'));
  assert.ok(P.detectPRs(sets(30, [11, 9, 8]), hist).some((p) => p.type === 'reps'));
  assert.ok(P.detectPRs(sets(30, [10, 10, 10, 10]), hist).some((p) => p.type === 'volume'));
  assert.deepEqual(P.detectPRs(sets(30, [8, 8]), hist), []);
});
console.log(`progression: ${n} tests passed`);
