/** Hash router: #/today, #/plan, #/run/<id> ... (GitHub Pages safe: never needs server-side deep links). */
export const hooks = { refresh: () => {} };
export function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs || '') };
}
export function go(path, { replace = false } = {}) {
  const url = `#/${path.replace(/^#?\/?/, '')}`;
  if (replace) location.replace(url); else location.hash = url;
}
export const refresh = (opts) => hooks.refresh(opts);
