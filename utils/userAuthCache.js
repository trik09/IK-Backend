import User from "../models/UserSchema.js";

const AUTH_USER_TTL_MS = 30_000;
const AUTH_USER_FIELDS = "_id name username email avatar";
const cache = new Map();

const pruneIfNeeded = () => {
  if (cache.size < 500) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
};

export const invalidateAuthUserCache = (userId) => {
  if (!userId) return;
  cache.delete(String(userId));
};

export const getAuthUserById = async (userId) => {
  if (!userId) return null;
  const key = String(userId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const user = await User.findById(userId).select(AUTH_USER_FIELDS).lean();
  if (!user) {
    cache.delete(key);
    return null;
  }

  pruneIfNeeded();
  cache.set(key, { user, expiresAt: Date.now() + AUTH_USER_TTL_MS });
  return user;
};
