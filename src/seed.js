/** Default program (section 8 of the brief). Every value is editable in the app. Weights are starting estimates. */
const q = (n) => `${n} proper form shorts`;
const ex = (id, name, equipment, muscles, cues, incrementKg, extra = {}) => ({
  id, name, equipment, muscles, cues, videoUrl: null, searchQuery: q(name), incrementKg,
  pulleyRatio: '', pinnedNote: '', archived: false, createdAt: 0, ...extra,
});
const CRUNCH = 'Kneel under the rope held at the forehead. Hips stay still. Curl ribs toward pelvis (spine curl, not a hip hinge). Exhale hard at the bottom, squeeze 1-2 s, rise slowly. No arm pulling. Lower-back pain means drop the weight.';

export const SEED_EXERCISES = [
  ex('ex-db-bench', 'Flat DB Bench Press', 'dumbbell', ['Chest', 'Front delts', 'Triceps'], 'Shoulder blades pinched back, feet flat. Lower to chest level over 2 s. No elbow lockout. (Smith flat press is fine as a swap.)', 2),
  ex('ex-smith-incline', 'Smith Incline Press (30 degrees)', 'smith', ['Upper chest', 'Front delts', 'Triceps'], 'Elbows about 45 degrees from torso, bar to upper chest. Set safeties just below chest height.', 2.5),
  ex('ex-db-shoulder-press', 'Seated DB Shoulder Press', 'dumbbell', ['Delts', 'Triceps'], 'Back on the pad, no arching. Lower over 2 s.', 2),
  ex('ex-lateral-raise', 'Lateral Raise', 'dumbbell', ['Side delts'], 'Slight elbow bend, lead with the elbows, no swinging.', 1),
  ex('ex-pushdown', 'Cable Triceps Pushdown', 'cable', ['Triceps'], 'Elbows pinned to your sides. Full extension at the bottom.', 2.5),
  ex('ex-crunch-light', 'Cable Crunch (light)', 'cable', ['Abs'], CRUNCH, 2.5),
  ex('ex-crunch-heavy', 'Cable Crunch (heavy)', 'cable', ['Abs'], CRUNCH + ' Heavy days are never back to back.', 2.5, { pinnedNote: 'Check whether your cable stack is 1:1 or 2:1 and note it in Pulley ratio.' }),
  ex('ex-crunch-burnout', 'Cable Crunch (burnout)', 'cable', ['Abs'], CRUNCH, 2.5),
  ex('ex-lat-pulldown', 'Lat Pulldown', 'machine', ['Lats', 'Biceps'], 'Chest up, bar to upper chest, elbows down. No leaning back.', 2.5),
  ex('ex-seated-row', 'Seated Cable Row', 'cable', ['Mid-back', 'Lats', 'Rear delts'], 'Squeeze shoulder blades together and pause 1 s.', 2.5),
  ex('ex-assisted-pullup', 'Assisted Pull-up', 'assisted', ['Lats', 'Biceps'], 'Full hang to chin over the bar. No kicking. Less assistance = progress.', 2.5, { pinnedNote: 'Choose assistance that gives clean reps.' }),
  ex('ex-face-pull', 'Face Pull', 'cable', ['Rear delts', 'Upper back'], 'Rope to face, elbows high.', 2.5),
  ex('ex-db-curl', 'DB Curl', 'dumbbell', ['Biceps'], 'No swinging. Lower over 2 s.', 1),
  ex('ex-rear-delt-fly', 'Reverse Butterfly (rear delt machine)', 'machine', ['Rear delts', 'Upper back'], 'Light and controlled. A bent-over rear delt fly with dumbbells is a fine swap.', 1),
  ex('ex-close-pulldown', 'Close-Grip (Neutral) Lat Pulldown', 'machine', ['Lats'], 'Chest up, pull elbows down and back.', 2.5),
  ex('ex-pec-deck', 'Butterfly / Pec Deck', 'machine', ['Chest'], 'Handles at mid-chest, back flat, slight elbow bend. Squeeze 1 s. Do not let the stack slam.', 2.5),
  ex('ex-one-arm-row', 'One-Arm DB Row', 'dumbbell', ['Mid-back', 'Lats'], 'Pull the elbow to your hip, flat back. Reps are per side.', 2),
  ex('ex-straight-arm', 'Straight-Arm Pulldown', 'cable', ['Lats'], 'Arms nearly straight, sweep the bar to your thighs.', 2.5),
  ex('ex-incline-curl', 'Incline DB Curl', 'dumbbell', ['Biceps'], 'Bench at 45-60 degrees, arms hang straight, no swinging.', 1),
  ex('ex-oh-triceps', 'Overhead DB Triceps Extension', 'dumbbell', ['Triceps'], 'Elbows close to your head.', 2),
  ex('ex-hack-squat', 'Hack Squat', 'machine', ['Quads', 'Glutes'], 'Feet shoulder width, down to about 90 degrees, heels flat, no knee lockout.', 5, { pinnedNote: 'Log plates per side x2, or just the number you use consistently.' }),
  ex('ex-rdl', 'DB Romanian Deadlift', 'dumbbell', ['Hamstrings', 'Glutes'], 'Hips back, flat back, slight knee bend. Dumbbells slide down the thighs.', 2),
  ex('ex-leg-curl', 'Prone Leg Curl', 'machine', ['Hamstrings'], 'Lower over 2-3 s, hips stay on the pad.', 2.5),
  ex('ex-leg-extension', 'Leg Extension', 'machine', ['Quads'], 'Control the lowering. Pause at the top.', 2.5),
  ex('ex-abduction', 'Leg Abduction Machine', 'machine', ['Outer glutes'], 'Smooth reps, no bouncing.', 2.5),
  ex('ex-calf-raise', 'Weighted Calf Raise (DB, on a step)', 'dumbbell', ['Calves'], 'Full stretch at the bottom, pause 1 s at the top.', 2),
  ex('ex-cardio', 'Easy Cardio (bike or incline walk)', 'cardio', [], 'Easy pace. You should be able to talk the whole time.', 0),
];

const it = (exerciseId, sets, repMin, repMax, restSec, startWeightKg, extra = {}) => ({ exerciseId, sets, repMin, repMax, restSec, startWeightKg, optional: false, note: '', ...extra });
const lightCrunch = (rest = 30) => it('ex-crunch-light', 3, 15, 15, rest, 25);
const heavyCrunch = () => it('ex-crunch-heavy', 4, 15, 15, 45, 50, {
  repsPerSet: [15, 15, 15, 8], heavyCrunch: true, lightAlt: { exerciseId: 'ex-crunch-light', sets: 3, repMin: 15, repMax: 15, restSec: 30, startWeightKg: 25 },
});
const sec = (type, durationMin, items) => (items ? { type, durationMin, items } : { type, durationMin });

export const SEED_DAYS = [
  { id: 'day-push', name: 'Push', focus: 'Chest, shoulders, triceps', order: 0, defaultWeekday: 1, sections: [
    sec('warmup', 10), sec('lifts', 42, [
      it('ex-db-bench', 3, 8, 10, 90, 8), it('ex-smith-incline', 3, 10, 10, 90, 20), it('ex-db-shoulder-press', 3, 10, 10, 90, 6),
      it('ex-lateral-raise', 4, 12, 15, 60, 3), it('ex-pushdown', 3, 12, 12, 60, 15)]),
    sec('crunch', 5, [lightCrunch()]), sec('cooldown', 3)] },
  { id: 'day-pull', name: 'Pull', focus: 'Back, biceps', order: 1, defaultWeekday: 2, sections: [
    sec('warmup', 10), sec('lifts', 42, [
      it('ex-lat-pulldown', 4, 10, 10, 90, 30), it('ex-seated-row', 3, 10, 10, 90, 30), it('ex-assisted-pullup', 3, 6, 8, 90, 30),
      it('ex-face-pull', 3, 15, 15, 60, 10), it('ex-db-curl', 3, 10, 10, 60, 6)]),
    sec('crunch', 5, [lightCrunch()]), sec('cooldown', 3)] },
  { id: 'day-shoulders', name: 'Shoulders + Crunch + Cardio', focus: 'Delts, abs, easy cardio', order: 2, defaultWeekday: 3, sections: [
    sec('warmup', 10), sec('lifts', 15, [
      it('ex-lateral-raise', 4, 15, 15, 60, 3), it('ex-rear-delt-fly', 3, 15, 15, 60, 3), it('ex-face-pull', 3, 15, 15, 60, 10)]),
    sec('crunch', 17, [heavyCrunch(), it('ex-crunch-burnout', 2, 20, 20, 30, 25)]),
    sec('cardio', 15, [{ kind: 'cardio', exerciseId: 'ex-cardio', name: 'Easy cycling or incline walk', minMin: 12, minMax: 15, note: 'Easy pace, you can talk the whole time.' }]),
    sec('cooldown', 3)] },
  { id: 'day-vtaper', name: 'V-Taper + Arms', focus: 'Lats, chest, arms', order: 3, defaultWeekday: 4, sections: [
    sec('warmup', 10), sec('lifts', 42, [
      it('ex-close-pulldown', 3, 10, 12, 90, 30), it('ex-pec-deck', 3, 12, 15, 60, 15), it('ex-one-arm-row', 3, 10, 10, 60, 10, { note: 'Reps are per side.' }),
      it('ex-straight-arm', 3, 12, 12, 60, 10), it('ex-incline-curl', 3, 12, 12, 60, 5), it('ex-oh-triceps', 3, 12, 12, 60, 8)]),
    sec('crunch', 5, [lightCrunch()]), sec('cooldown', 3)] },
  { id: 'day-legs', name: 'Legs', focus: 'Quads, hamstrings, calves, abs', order: 4, defaultWeekday: 5, sections: [
    sec('warmup', 10), sec('lifts', 42, [
      it('ex-hack-squat', 3, 10, 10, 90, 10), it('ex-rdl', 3, 10, 10, 90, 8), it('ex-leg-curl', 3, 12, 12, 60, 15),
      it('ex-leg-extension', 2, 12, 15, 60, 15), it('ex-abduction', 2, 15, 15, 45, 20, { optional: true }),
      it('ex-calf-raise', 4, 15, 15, 45, 10)]),
    sec('crunch', 5, [heavyCrunch()]), sec('cooldown', 3)] },
];

const step = (name, extra = {}) => ({ name, searchQuery: `${name} exercise form shorts`, ...extra });
const blockA = () => ({ id: 'A', name: 'Block A: Get warm', durationSec: 120, steps: [
  step('March in place', { seconds: 30 }), step('Easy jumping jacks (or step-jacks)', { seconds: 30 }),
  step('Light high knees', { seconds: 30 }), step('Butt kicks', { seconds: 30 })] });
const blockB = (steps) => ({ id: 'B', name: 'Block B: Slow and controlled, 1 round', durationSec: 300, steps });
const S = (n, amount) => step(n, { amount });
const WARM = {
  'day-push': [S('Arm circles', '10 forward / 10 back'), S('Shoulder rolls', '10 each way'), S('Wall slides', 'x10'), S('Scapular push-ups', 'x10'),
    S('Push-ups (knee if needed)', 'x8 slow'), S('Open-book thoracic rotation', 'x8 each side'), S('Cat-cow', 'x8')],
  'day-pull': [S('Cat-cow', 'x8'), S("Child's pose to cobra", 'x6'), S('Prone Y-T-W raises', '6 each'), S('Superman hold', '3 x 10 s'),
    S('Wall angels', 'x10'), S('Bird-dog', '6 each side'), S('Arm swings', 'x10')],
  'day-shoulders': [S('Arm circles', '10 each way'), S('Wall slides', 'x10'), S('Prone Y-T-W raises', '5 each'), S('Scapular push-ups', 'x10'),
    S('Dead bug', '6 each side'), S('Cat-cow', 'x8'), S('Torso twists', '10 each side')],
  'day-vtaper': [S('Arm circles', '10 each way'), S('Shoulder rolls', '10 each way'), S('Cat-cow', 'x8'), S('Wall angels', 'x10'),
    S('Scapular push-ups', 'x10'), S('Open-book rotation', 'x8 each side'), S('Wrist circles', '10 each way'), S('Prone Y raises', 'x8')],
  'day-legs': [S('Leg swings front-back (hold a wall)', 'x10 each leg'), S('Leg swings side-side', 'x10 each leg'), S('Hip circles', 'x8 each way'),
    S('Bodyweight squats', 'x10 slow'), S('Glute bridges (1 s squeeze)', 'x12'), S('Bodyweight good mornings', 'x10'),
    S('Reverse lunges', 'x6 each leg'), S("World's greatest stretch", 'x3 each side'), S('Bodyweight calf raises', 'x15')],
};
const COOL = () => [{ id: 'C', name: 'Cooldown stretches (3 min)', durationSec: 180, steps: [
  step('Doorway chest stretch', { seconds: 30 }),
  step('Lat / hang stretch (no bar: kneel, reach forward, sit back toward heels)', { seconds: 30, searchQuery: 'kneeling lat stretch child pose shorts' }),
  step('Hamstring stretch, left leg', { seconds: 30 }), step('Hamstring stretch, right leg', { seconds: 30 }),
  step('Deep breathing', { seconds: 30 })] }];

export const SEED_WARMUPS = SEED_DAYS.flatMap((d) => [
  { id: `wu-${d.id}`, dayId: d.id, kind: 'warmup', blocks: [blockA(), blockB(WARM[d.id])] },
  { id: `cd-${d.id}`, dayId: d.id, kind: 'cooldown', blocks: COOL() },
]);

export const DEFAULT_SETTINGS = {
  units: 'kg', smithBarKg: 20, barbellBarKg: 20, theme: 'auto', batterySaver: false, sound: true, vibrate: true, wakeLock: true,
  programWeekOverride: null, lastBackupAt: null, backupDismissedAt: null, setupDone: false, startDate: null, pulleyRatio: '1:1',
};
