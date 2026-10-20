/**
 * Shell-aware navigation for the federated remote.
 *
 * The shell owns the top-level route. A remote can still move between records by
 * updating the browser URL with `pushState` and then emitting `popstate`, which
 * is exactly what the shell listens for. If either API is unavailable (or the
 * history call fails, for example in a sandboxed iframe), fall back to a normal
 * browser navigation.
 */
export function navigate(target, options = {}) {
  const path = String(target || '/');
  try {
    if (options.replace) {
      window.history.replaceState({}, '', path);
    } else {
      window.history.pushState({}, '', path);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  } catch {
    window.location.assign(path);
    return false;
  }
}

/** Builds a shell route for another vertical, preserving the record query. */
export function recordHref(route, recordId) {
  const path = `/${String(route || '').replace(/^\/+/, '')}`;
  return recordId ? `${path}?record=${encodeURIComponent(recordId)}` : path;
}
