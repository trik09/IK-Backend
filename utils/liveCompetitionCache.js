import { recordHit, recordMiss } from "./cacheMetrics.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import { safeRedisDel, safeRedisGet, safeRedisSetex } from "./redisWrapper.js";

const PUZZLE_TTL_MS = 2 * 60 * 60 * 1000;
const META_TTL_MS = 15_000;
const VALID_IDS_TTL_MS = 60_000;
const PUZZLE_LIST_TTL_MS = 10 * 60 * 1000;
const REDIS_META_TTL_SEC = 30;
const REDIS_PUZZLE_LIST_TTL_SEC = 600;

export const PUZZLE_LIVE_SELECT =
  "title description difficulty category type fen solutionMoves alternativeSolutions firstMoveBy captureConfig kidsConfig illegalConfig level rating";

const puzzleCache = new Map();
const metaCache = new Map();
const validIdsCache = new Map();
const puzzleListCache = new Map();

const pruneMap = (map, max = 2000) => {
  if (map.size <= max) return;
  const now = Date.now();
  for (const [key, value] of map) {
    const exp = value.expiresAt ?? (value.ts != null ? value.ts + META_TTL_MS : 0);
    if (exp && exp < now) map.delete(key);
  }
  if (map.size > max) {
    const overflow = map.size - max;
    const keys = map.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) break;
      map.delete(next.value);
    }
  }
};

export function primePuzzlesForValidation(puzzles) {
  const expiresAt = Date.now() + PUZZLE_TTL_MS;
  for (const puzzle of puzzles || []) {
    if (!puzzle?._id) continue;
    puzzleCache.set(String(puzzle._id), { puzzle, expiresAt });
  }
}

export async function getPuzzleForValidation(puzzleId) {
  const key = String(puzzleId);
  const hit = puzzleCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    recordHit("puzzleCache");
    return hit.puzzle;
  }
  recordMiss("puzzleCache");

  const puzzle = await PuzzleModel.findById(puzzleId)
    .select(PUZZLE_LIVE_SELECT)
    .lean();
  if (puzzle) {
    puzzleCache.set(key, { puzzle, expiresAt: Date.now() + PUZZLE_TTL_MS });
  }
  return puzzle;
}

export function getCachedCompetitionLiveMeta(competitionId) {
  const hit = metaCache.get(String(competitionId));
  if (hit && Date.now() - hit.ts < META_TTL_MS) {
    recordHit("competitionLiveMeta");
    return hit.data;
  }
  recordMiss("competitionLiveMeta");
  return null;
}

export function setCachedCompetitionLiveMeta(competitionId, data, { persistRedis = true } = {}) {
  metaCache.set(String(competitionId), { data, ts: Date.now() });
  pruneMap(metaCache);
  if (persistRedis) {
    safeRedisSetex(`comp:meta:${competitionId}`, REDIS_META_TTL_SEC, data).catch(() => {});
  }
}

export async function getRedisCompetitionLiveMeta(competitionId) {
  const cached = getCachedCompetitionLiveMeta(competitionId);
  if (cached) return cached;
  const fromRedis = await safeRedisGet(`comp:meta:${competitionId}`);
  if (fromRedis) {
    setCachedCompetitionLiveMeta(competitionId, fromRedis, { persistRedis: false });
    return fromRedis;
  }
  return null;
}

export function invalidateCompetitionLiveMeta(competitionId) {
  if (!competitionId) return;
  const key = String(competitionId);
  metaCache.delete(key);
  puzzleListCache.delete(key);
  safeRedisDel(`comp:meta:${key}`, `comp:puzzles:${key}`).catch(() => {});
}

export async function getCachedPuzzleList(competitionId) {
  const key = String(competitionId);
  const hit = puzzleListCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    recordHit("competitionPuzzles");
    return hit.puzzles;
  }
  const fromRedis = await safeRedisGet(`comp:puzzles:${key}`);
  if (Array.isArray(fromRedis) && fromRedis.length) {
    setCachedPuzzleList(competitionId, fromRedis, { persistRedis: false });
    recordHit("competitionPuzzles");
    return fromRedis;
  }
  recordMiss("competitionPuzzles");
  return null;
}

export function setCachedPuzzleList(competitionId, puzzles, { persistRedis = true } = {}) {
  puzzleListCache.set(String(competitionId), {
    puzzles,
    expiresAt: Date.now() + PUZZLE_LIST_TTL_MS,
  });
  pruneMap(puzzleListCache, 200);
  primePuzzlesForValidation(puzzles);
  if (persistRedis) {
    safeRedisSetex(`comp:puzzles:${competitionId}`, REDIS_PUZZLE_LIST_TTL_SEC, puzzles).catch(
      () => {}
    );
  }
}

export { parseLeaderboardPaging } from "./paging.js";

export async function getValidPuzzleIdsCached(competitionId, rawIds, loader) {
  const key = String(competitionId);
  const hit = validIdsCache.get(key);
  if (hit && Date.now() - hit.ts < VALID_IDS_TTL_MS) {
    return hit.ids;
  }
  const ids = await loader(rawIds);
  validIdsCache.set(key, { ids, ts: Date.now() });
  return ids;
}
