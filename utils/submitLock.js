import redis from "../config/redis.js";

const DEFAULT_TTL_MS = 8000;

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
