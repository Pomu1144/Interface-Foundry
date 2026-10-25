// Hash router. Routes look like "#/payment"; anything else in the hash (an
// in-page anchor such as "#main-content") is ignored so it can't break routing.

const ROUTE_HASH = /^#\/([a-z][a-z-]*)\/?$/;

export function parseRoute(hash = window.location.hash) {
  const match = ROUTE_HASH.exec(hash);
  return match ? match[1] : null;
}

export function createRouter({ routes, fallback, onRoute }) {
  let current = null;

  function urlFor(name) {
    return `${window.location.pathname}${window.location.search}#/${name}`;
  }

  function resolve(initial) {
    const hash = window.location.hash;
    if (hash && !hash.startsWith('#/') && current) {
      // In-page anchor: keep the current route in the address bar.
      window.history.replaceState(window.history.state, '', urlFor(current));
      return;
    }
    let name = parseRoute(hash);
    if (!name || !Object.hasOwn(routes, name)) {
      name = fallback;
      window.history.replaceState(window.history.state, '', urlFor(name));
    }
    const previous = current;
    current = name;
    onRoute(name, { previous, initial });
  }

  window.addEventListener('hashchange', () => resolve(false));

  return {
    start() {
      resolve(true);
    },
    get current() {
      return current;
    },
    navigate(name, { replace = false } = {}) {
      if (!Object.hasOwn(routes, name)) name = fallback;
      if (parseRoute() === name) {
        // Same hash: hashchange will not fire, so render directly.
        const previous = current;
        current = name;
        onRoute(name, { previous, initial: false });
        return;
      }
      if (replace) {
        window.history.replaceState(window.history.state, '', urlFor(name));
        resolve(false);
      } else {
        window.location.hash = `#/${name}`;
      }
    },
    /** Re-render the current route without changing history. */
    refresh() {
      if (current) onRoute(current, { previous: current, initial: false, refresh: true });
    },
  };
}
