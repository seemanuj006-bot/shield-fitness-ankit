/** Shared UI building blocks: icons, chips, sheets, dialogs, toasts. */
import { esc } from '../util.js';

export const icon = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
export const chip = (txt, kind = '') => `<span class="chip ${kind}">${esc(txt)}</span>`;
export const pageHeader = (title, { back = '', right = '', sub = '' } = {}) => `
  <header class="topbar"><div class="topbar-in">
    ${back ? `<a class="iconbtn" href="#/${back}" aria-label="Back">${icon('chevron-left')}</a>` : `<img class="logo" src="assets/icons/logo-96.png" alt="" width="32" height="32">`}
    <div class="grow"><h1 class="title">${esc(title)}</h1>${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</div>
    ${right}
  </div></header>`;
export const segmented = (act, options, value) => `<div class="seg" role="tablist">${options.map(([v, l]) =>
  `<button role="tab" aria-selected="${v === value}" class="${v === value ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;

/** Bottom sheet. handlers: {name: fn(el, ev)} for [data-sh="name"] clicks inside. Returns {close, root}. */
export function sheet(html, handlers = {}, { onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'sheet-wrap';
  root.innerHTML = `<div class="scrim" data-sh="__close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { root.remove(); onClose?.(); };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sh]');
    if (!t) return;
    const n = t.dataset.sh;
    if (n === '__close') return close();
    handlers[n]?.(t, e, close);
  });
  root.addEventListener('change', (e) => { const t = e.target.closest('[data-shchg]'); if (t) handlers[t.dataset.shchg]?.(t, e, close); });
  document.body.appendChild(root);
  root.querySelector('button, input, select')?.focus({ preventScroll: true });
  return { close, root };
}

export function confirmDialog({ title = 'Are you sure?', message = '', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => (c) => { done = true; c(); resolve(v); };
    sheet(`<h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
      <div class="stack"><button class="btn ${danger ? 'danger' : 'primary'} block" data-sh="ok">${esc(okLabel)}</button>
      <button class="btn secondary block" data-sh="no">${esc(cancelLabel)}</button></div>`,
    { ok: (_t, _e, c) => fin(true)(c), no: (_t, _e, c) => fin(false)(c) }, { onClose: () => { if (!done) resolve(false); } });
  });
}

let toastEl, toastT;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

export const field = (label, inner, hint = '') => `<label class="field"><span class="lbl">${esc(label)}</span>${inner}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
export const emptyState = (title, text, action = '') => `<div class="empty"><div class="empty-t">${esc(title)}</div><p class="muted">${esc(text)}</p>${action}</div>`;
