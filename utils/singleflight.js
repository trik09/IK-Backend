/**
 * Coalesce concurrent identical async work (leaderboard rebuild, puzzle cache fill).
 */
export function createSingleflight() {
  const inflight = new Map();

  return async function singleflight(key, fn) {
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = Promise.resolve()
      .then(fn)
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };
}
