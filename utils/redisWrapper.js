import redis from "../config/redis.js";

export const safeRedisGet = async (key, fallback = null) => {
  try {
    const data = await redis.get(key);
    if (data == null) return fallback;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  } catch (err) {
    console.error(`[Redis] GET failed for ${key}:`, err.message);
    return fallback;
  }
};

export const safeRedisSet = async (key, value, options = {}) => {
  try {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    if (options.EX) {
      await redis.set(key, serialized, "EX", options.EX);
    } else {
      await redis.set(key, serialized);
    }
    return true;
  } catch (err) {
    console.error(`[Redis] SET failed for ${key}:`, err.message);
    return false;
  }
};

export const safeRedisSetex = async (key, ttlSec, value) => {
  try {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await redis.setex(key, ttlSec, serialized);
    return true;
  } catch (err) {
    console.error(`[Redis] SETEX failed for ${key}:`, err.message);
    return false;
  }
};

export const safeRedisDel = async (...keys) => {
  try {
    await redis.del(...keys);
    return true;
  } catch (err) {
    console.error(`[Redis] DEL failed:`, err.message);
    return false;
  }
};
