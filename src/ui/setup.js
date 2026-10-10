/** First-run setup: units, bar weight, pulley ratio, and the optional partial first Monday. */
import * as db from '../db.js';
import { store, setSetting, saveState } from '../store.js';
import { seedPartialMonday } from '../session.js';
import { localDateStr } from '../scheduler.js';
import { go } from '../router.js';
import { esc, parseW, units } from '../util.js';
import { toast, field, segmented } from './components.js';

let draft = { unit: 'kg', partial: true };

export async function render() {
  document.body.dataset.route = 'setup';
  const html = `<div class="page setup"><section class="card stack center"><img class="logo-big" src="assets/icons/logo-96.png" alt="" width="72" height="72">
    <h1 class="title">Welcome to Shield Fitness</h1><p class="muted">Your 5-day plan is loaded. Open the app, see what to do, log it in a few taps. Quick setup first.</p></section>
    <section class="card stack"><div class="stack-s"><span class="lbl">Units</span>${segmented('unit', [['kg', 'Kilograms'], ['lb', 'Pounds']], draft.unit)}</div>
      ${field('Smith machine bar weight (kg)', `<input id="s-bar" inputmode="decimal" value="20">`, 'Default 20 kg. Typically 7-20 kg. Check your gym and edit later in Settings.')}
      ${field('Cable stack pulley ratio (for crunches)', `<select id="s-ratio"><option>1:1</option><option>2:1</option></select>`, 'Not sure? Pick 1:1. You can change it later.')}</section>
    <section class="card stack"><label class="check"><input type="checkbox" id="s-partial" ${draft.partial ? 'checked' : ''} data-chg="partial"><span>I already started my first Push day (Smith incline and flat DB press are done)</span></label>
      <div id="partial-fields" class="stack-s ${draft.partial ? '' : 'hidden'}"><div class="grid3">${field('Flat DB kg each hand', `<input id="p-kg" inputmode="decimal" value="8">`)}${field('Sets', `<input id="p-sets" inputmode="numeric" value="3">`)}${field('Reps', `<input id="p-reps" inputmode="numeric" value="8">`)}</div>
      <p class="small muted">Smith incline is logged as 3 × 10 with 20 kg plates added. You will resume at seated shoulder press.</p></div></section>
    <button class="btn primary big block" data-act="go">Start training</button></div>`;
  return { html, nav: false, act: { unit: (el) => { draft.unit = el.dataset.v; units.unit = draft.unit; el.parentElement.querySelectorAll('button').forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); },
    go: async (el) => {
      el.disabled = true;
      try {
        const bar = parseFloat(document.getElementById('s-bar').value.replace(',', '.'));
        if (!(bar >= 0 && bar <= 40)) { el.disabled = false; return toast('Smith bar weight should be between 0 and 40 kg.'); }
        const ratio = document.getElementById('s-ratio').value;
        await setSetting('units', draft.unit); await setSetting('smithBarKg', bar); await setSetting('pulleyRatio', ratio);
        for (const id of ['ex-crunch-light', 'ex-crunch-heavy', 'ex-crunch-burnout']) await db.put('exercises', (store.exercises[id] = { ...store.exercises[id], pulleyRatio: ratio }));
        await setSetting('startDate', localDateStr()); await setSetting('setupDone', true);
        await saveState({ queue: store.days.map((d) => d.id) });
        if (document.getElementById('s-partial').checked) {
          const kg = parseFloat(document.getElementById('p-kg').value.replace(',', '.')), sets = parseInt(document.getElementById('p-sets').value, 10), reps = parseInt(document.getElementById('p-reps').value, 10);
          if (kg >= 0 && sets > 0 && reps > 0) await seedPartialMonday({ flatKg: kg, flatSets: sets, flatReps: reps });
        }
        navigator.storage?.persist?.();
        go('today');
      } catch (e) { el.disabled = false; toast(`Setup failed: ${e.message}`); }
    } },
    chg: { partial: (el) => document.getElementById('partial-fields').classList.toggle('hidden', !el.checked) } };
}
