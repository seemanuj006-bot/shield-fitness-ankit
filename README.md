# Shield Fitness

A private, offline workout tracker (installable PWA). No accounts, no backend, no tracking. All data lives in your phone's IndexedDB. Built with plain JavaScript ES modules, so there is **no build step**.

- Today screen shows exactly what to do next. A rolling queue handles missed days (do it today, skip, or move).
- Workout runner: ramp-up sets, last-session numbers, double-progression suggestions, rest timer that survives screen lock, crash-safe saving.
- Progress: lift charts, PRs, body weight, measurements, photos, calendar, history, core tests.
- Everything is editable: exercises, days, warm-ups, phase rules, units.

## Deploy on GitHub Pages

1. Create a new repository on GitHub (for example `shield-fitness`). Public is fine; your workout data never leaves your phone.
2. Upload **all files in this folder** (drag and drop in the GitHub web UI), including the hidden `.nojekyll` file. Commit to the `main` branch.
3. Go to **Settings > Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. Wait a minute or two. Your URL will be `https://<username>.github.io/<repo-name>/`.
5. Open that URL on your phone.
   - **Android (Chrome):** menu > *Install app*.
   - **iPhone (Safari):** Share > *Add to Home Screen*. Installing matters on iOS: Safari can clear data of sites you have not opened in a while unless the app is installed.
6. Open it once while online so it caches itself. After that it works fully offline.

## Update the app

1. Replace the changed files in the repo.
2. Open `sw.js` and change `VERSION` (for example `shield-fitness-v1.0.1`). If you added or removed files, update the `ASSETS` list too.
3. Commit. The next time you open the app it shows **Update available, Reload**. It never reloads on its own, so an open workout is never disturbed.

## Back up and restore

- **Settings > Export backup** downloads one JSON file (including photos). The app nudges you weekly on the Today screen.
- **Settings > Import a backup** shows a preview first. *Merge* only adds records that are not already there (no duplicates). *Replace* overwrites everything.
- Save backups somewhere that syncs (iCloud Drive, Google Drive, email to yourself).

## Customize the program

- **Plan tab:** tap a day, then *Edit* to change sets, reps, rest, start weights, order, weekday, optional exercises, swap exercises, and edit warm-up/cooldown templates. Changes save immediately and never alter past sessions (every session stores a snapshot of its plan).
- **Exercise library:** rename, add, archive, set the increment per exercise, pulley ratio, a pinned note, and a **custom video link** (it overrides the default YouTube search). You can also tap *Replace link* mid-workout.
- **Settings:** units, Smith bar weight, phase rules (sets cap and weight % per phase), pause, theme, battery saver.
- **Reset to the default program** (Plan tab) restores the seed program and never touches history.

## How scheduling works (short version)

The 5 workouts form a queue. "Next up" is the first workout not yet done or skipped; weekdays are only the default. Past training weekdays with nothing logged show a **missed** banner: *Do it today* (everything shifts one slot later, weekends can become training days that week), *Skip it*, or *Move to a day*. Returning after a gap lowers loads automatically (3-6 days: 90%, one fewer set; 7-13: 80%, 2 sets; 14+: 70%, 2 sets, Phase A rules), with a one-tap "use normal loads". Heavy crunches never land on consecutive days (the second becomes the light version). Phase follows completed training weeks, not the calendar.

## Develop and test

```
npm test            # scheduler + progression unit tests, plain Node, no dependencies
python3 -m http.server 8000   # then open http://localhost:8000
```

Layout of `src/`: `scheduler.js`, `progression.js`, `planner.js` are pure functions (unit-tested). `db.js` (IndexedDB), `store.js`, `session.js`, `timer.js`, `router.js`, `seed.js`, `app.js`, `ui/*`, `styles/*`.

## Intentionally left out (and why)

- **Supersets/circuits, pre-workout soreness check-in, history search and date comparison:** listed as nice-to-have; skipped to keep the must-haves solid and the code small.
- **`favicon.ico`:** a PNG favicon is used; all current browsers accept it.
- **Notifications when a timer ends while the phone is locked:** browsers cannot play sound or vibrate from a locked page reliably without a push server. The timer is always correct when you unlock; it also beeps and vibrates if the app is open.
- **Hosted video embeds:** links only, to save battery and data and to work offline.
- **Smith bar default is 20 kg and the crunch pulley ratio is 1:1** until you set them in the first-run screen or Settings.

Starting weights are estimates for a beginner, not tested numbers. Sharp or joint pain means stop that exercise. Severe pain, major swelling or dark brown urine after training means see a doctor.
