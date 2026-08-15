const CACHE_TTL_MS = 30_000;
const cache = new Map();

export const getCachedActiveParticipation = (userId) => {
  const key = String(userId);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
};

export const setCachedActiveParticipation = (userId, data) => {
  cache.set(String(userId), { data, ts: Date.now() });
};

export const invalidateActiveParticipationCache = (userId) => {
  cache.delete(String(userId));
};
