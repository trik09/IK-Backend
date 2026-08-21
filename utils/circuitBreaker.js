/**
 * Lightweight circuit breaker for Mongo fallbacks under arena load.
 * Fail-open after consecutive errors so Redis-only reads can keep serving.
 */
export function createCircuitBreaker({
  name = "breaker",
  failureThreshold = 5,
  resetMs = 10_000,
} = {}) {
  let failures = 0;
  let openedAt = 0;
  let state = "closed";

  const snapshot = () => ({ name, state, failures });

  return {
    snapshot,
    isOpen() {
      if (state !== "open") return false;
      if (Date.now() - openedAt >= resetMs) {
        state = "half_open";
        return false;
      }
      return true;
    },
    async exec(fn, fallback) {
      if (this.isOpen()) {
        if (typeof fallback === "function") return fallback();
        return fallback;
      }
      try {
        const result = await fn();
        failures = 0;
        state = "closed";
        return result;
      } catch (err) {
        failures += 1;
        if (failures >= failureThreshold) {
          state = "open";
          openedAt = Date.now();
          console.warn(
            `[CircuitBreaker] ${name} OPEN after ${failures} failures: ${err?.message || err}`
          );
        }
        if (typeof fallback === "function") return fallback();
        throw err;
      }
    },
  };
}
