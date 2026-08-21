import PuzzleModel from "../models/PuzzleSchema.js";
import { safeRedisDel, safeRedisGet, safeRedisSetex } from "./redisWrapper.js";

export const PUZZLE_FILTER_CACHE_KEY = "puzzle:filter:options";
const PUZZLE_FILTER_TTL_SEC = 86400; // 24 hours

export async function getPuzzleFilterOptions() {
  const cached = await safeRedisGet(PUZZLE_FILTER_CACHE_KEY);
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return cached;
  }

  const [categories, difficulties, types, levels, ratings] = await Promise.all([
    PuzzleModel.distinct("category"),
    PuzzleModel.distinct("difficulty"),
    PuzzleModel.distinct("type"),
    PuzzleModel.distinct("level"),
    PuzzleModel.distinct("rating"),
  ]);

  const options = { categories, difficulties, types, levels, ratings };
  await safeRedisSetex(PUZZLE_FILTER_CACHE_KEY, PUZZLE_FILTER_TTL_SEC, options);
  return options;
}

export async function invalidatePuzzleFilterCache() {
  await safeRedisDel(PUZZLE_FILTER_CACHE_KEY);
}
