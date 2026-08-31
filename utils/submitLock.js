import redis from "../config/redis.js";

const DEFAULT_TTL_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-puzzle submit lock. Prevents concurrent scoring of the same attempt.
 * Returns true if this caller owns the lock.
 */
export async function acquireSubmitLock(competitionId, userId, puzzleId, ttlMs = DEFAULT_TTL_MS) {
  const key = `lock:submit:${competitionId}:${userId}:${puzzleId}`;
  try {
    const result = await redis.set(key, "1", "PX", ttlMs, "NX");
    return result === "OK";
  } catch (err) {
    console.warn("[SubmitLock] Redis lock unavailable, allowing request:", err.message);
    return true;
  }
}

export async function releaseSubmitLock(competitionId, userId, puzzleId) {
  const key = `lock:submit:${competitionId}:${userId}:${puzzleId}`;
  try {
    await redis.del(key);
  } catch {
    // ignore
  }
}

/**
 * Wait briefly for an in-flight submit to finish, then try to acquire the lock.
 * Reduces 409 "submission in progress" under concurrent retries / double-taps.
 */
export async function acquireSubmitLockWithWait(
  competitionId,
  userId,
  puzzleId,
  { maxWaitMs = 2000, pollMs = 200, ttlMs = DEFAULT_TTL_MS } = {}
) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const held = await acquireSubmitLock(competitionId, userId, puzzleId, ttlMs);
    if (held) return true;
    await sleep(pollMs);
  }
  return acquireSubmitLock(competitionId, userId, puzzleId, ttlMs);
}
