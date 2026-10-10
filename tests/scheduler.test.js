import assert from 'node:assert/strict';
import * as S from '../src/scheduler.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok -', name); };
// 2026-10-05 is a Monday
const MON = '2026-10-05';
const sess = (date, status = 'completed', extra = {}) => ({ date, status, ...extra });

t('date math is DST-safe', () => {
  assert.equal(S.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(S.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(S.daysBetween('2026-03-07', '2026-03-10'), 3);
  assert.equal(S.daysBetween('2026-10-24', '2026-11-02'), 9);
  assert.equal(S.weekdayOf(MON), 1);
  assert.equal(S.weekStart('2026-10-11'), MON);
});
t('program week and phase come from completed sessions', () => {
  assert.equal(S.programWeek(0), 1);
  assert.equal(S.programWeek(4), 1);
  assert.equal(S.programWeek(5), 2);
  assert.equal(S.programWeek(12), 3);
  assert.equal(S.programWeek(12, 6), 6);
  assert.equal(S.phaseFor(1), 'A'); assert.equal(S.phaseFor(2), 'A');
  assert.equal(S.phaseFor(3), 'B'); assert.equal(S.phaseFor(4), 'B');
  assert.equal(S.phaseFor(5), 'C'); assert.equal(S.phaseFor(20), 'C');
});
t('gap rules by days since last session', () => {
  assert.equal(S.gapAdjustment(0), null);
  assert.equal(S.gapAdjustment(2), null);
  assert.equal(S.gapAdjustment(3).pct, 90);
  assert.equal(S.gapAdjustment(6).setDelta, -1);
  assert.equal(S.gapAdjustment(7).pct, 80);
  assert.equal(S.gapAdjustment(13).sets, 2);
  const r = S.gapAdjustment(14);
  assert.equal(r.pct, 70); assert.equal(r.forcePhase, 'A');
  assert.equal(S.gapAdjustment(40).tier, 'restart');
  assert.equal(S.gapDays(null, MON), 0);
  assert.equal(S.gapDays('2026-10-09', MON), 0, 'timezone change must not produce a negative gap');
});
t('missing 1 day flags exactly that day', () => {
  const m = S.detectMissed({ today: '2026-10-07', startDate: MON, sessions: [sess(MON)] });
  assert.deepEqual(m, ['2026-10-06']);
});
t('missing 2, 3 days', () => {
  assert.equal(S.detectMissed({ today: '2026-10-08', startDate: MON, sessions: [sess(MON)] }).length, 2);
  assert.equal(S.detectMissed({ today: '2026-10-09', startDate: MON, sessions: [sess(MON)] }).length, 3);
});
t('weekends are never flagged and today is never missed', () => {
  assert.deepEqual(S.detectMissed({ today: '2026-10-12', startDate: MON,
    sessions: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => sess(d)) }), ['2026-10-09']);
  assert.deepEqual(S.detectMissed({ today: MON, startDate: MON, sessions: [] }), []);
});
t('skip, rest and moved markers resolve a missed day', () => {
  const sessions = [sess(MON), sess('2026-10-06', 'skipped'), sess('2026-10-07', 'rest'), sess('2026-10-08', 'moved')];
  assert.deepEqual(S.detectMissed({ today: '2026-10-09', startDate: MON, sessions }), []);
});
t('days before install are not missed; long absence is capped', () => {
  assert.deepEqual(S.detectMissed({ today: '2026-10-09', startDate: '2026-10-08', sessions: [] }), ['2026-10-08']);
  assert.ok(S.detectMissed({ today: '2026-12-01', startDate: MON, sessions: [] }).length <= 10);
});
t('pause freezes missed detection and ranges are ignored later', () => {
  assert.deepEqual(S.detectMissed({ today: '2026-10-09', startDate: MON, sessions: [], paused: true }), []);
  const ranges = [{ from: '2026-10-06', to: '2026-10-08' }];
  assert.deepEqual(S.detectMissed({ today: '2026-10-10', startDate: MON, sessions: [sess(MON)], pauseRanges: ranges }), ['2026-10-09']);
});
t('missed Friday legs allows Saturday as a training day', () => {
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => sess(d));
  const q = ['legs', 'push', 'pull', 'shoulders', 'vtaper'];
  const sat = S.todayPlan({ today: '2026-10-10', sessions: week, queue: q });
  assert.equal(sat.state, 'planned'); assert.equal(sat.extension, true); assert.equal(sat.nextDayId, 'legs');
  const sun = S.todayPlan({ today: '2026-10-11', sessions: [...week, sess('2026-10-10')], queue: q });
  assert.equal(sun.state, 'rest', 'cycle complete after the Saturday make-up');
});
t('full week means rest on weekend, weekdays plan next workout', () => {
  const full = ['05', '06', '07', '08', '09'].map((d) => sess('2026-10-' + d));
  assert.equal(S.todayPlan({ today: '2026-10-10', sessions: full, queue: ['a', 'b'].concat('c', 'd', 'e') }).state, 'rest');
  assert.equal(S.todayPlan({ today: '2026-10-12', sessions: full, queue: ['a', 'b', 'c', 'd', 'e'] }).state, 'planned');
  assert.equal(S.todayPlan({ today: '2026-10-10', sessions: [], queue: ['a', 'b', 'c', 'd', 'e'] }).state, 'planned');
});
t('today states: in progress (even from yesterday), done, manual rest, paused', () => {
  const q = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(S.todayPlan({ today: '2026-10-07', sessions: [sess('2026-10-06', 'in_progress')], queue: q }).state, 'in_progress');
  assert.equal(S.todayPlan({ today: MON, sessions: [sess(MON)], queue: q }).state, 'done');
  assert.equal(S.todayPlan({ today: MON, sessions: [sess(MON, 'rest')], queue: q }).state, 'rest');
  assert.equal(S.todayPlan({ today: MON, sessions: [], queue: q, paused: true }).state, 'paused');
});
t('queue: complete, skip, move and normalize', () => {
  const q = ['push', 'pull', 'sh', 'vt', 'legs'];
  assert.deepEqual(S.completeInQueue(q, 'push'), ['pull', 'sh', 'vt', 'legs', 'push']);
  assert.deepEqual(S.completeInQueue(q, 'sh'), ['push', 'pull', 'vt', 'legs', 'sh']);
  assert.deepEqual(S.moveInQueue(q, 'push', 2), ['pull', 'sh', 'push', 'vt', 'legs']);
  assert.deepEqual(S.moveInQueue(q, 'legs', 0)[0], 'legs');
  assert.deepEqual(S.normalizeQueue(['x', 'pull'], ['push', 'pull']), ['pull', 'push']);
  assert.equal(S.trainingSlotIndex('2026-10-07', '2026-10-09', [1, 2, 3, 4, 5]), 2);
  assert.equal(S.trainingSlotIndex('2026-10-09', '2026-10-12', [1, 2, 3, 4, 5]), 1, 'weekend slots do not count');
});
t('heavy crunch protection on consecutive days (before and after)', () => {
  const s = [sess('2026-10-07', 'completed', { heavyCrunch: true })];
  assert.equal(S.heavyCrunchConflict('2026-10-08', s), true);
  assert.equal(S.heavyCrunchConflict('2026-10-06', s), true);
  assert.equal(S.heavyCrunchConflict('2026-10-09', s), false);
  assert.equal(S.heavyCrunchConflict('2026-10-08', [sess('2026-10-07', 'skipped', { heavyCrunch: true })]), false);
});
t('back-to-back muscle warning uses major groups only', () => {
  const chest = S.muscleGroups(['Chest', 'Front delts', 'Triceps']);
  assert.deepEqual(chest.sort(), ['chest', 'shoulders', 'triceps']);
  assert.deepEqual(S.muscleGroups(['Rear delts', 'Glutes', 'Abs']), []);
  const prev = [sess('2026-10-07', 'completed', { muscleGroups: ['chest', 'triceps'] })];
  assert.deepEqual(S.backToBackMuscles(['chest', 'back'], '2026-10-08', prev), ['chest']);
  assert.deepEqual(S.backToBackMuscles(['back'], '2026-10-08', prev), []);
});
t('streak counts completed sessions until a skip', () => {
  const s = [sess('2026-10-05'), sess('2026-10-06', 'skipped'), sess('2026-10-07'), sess('2026-10-08')];
  assert.equal(S.streak(s), 2);
});
console.log(`scheduler: ${n} tests passed`);
