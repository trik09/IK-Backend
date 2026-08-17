import PuzzleModel from "../models/PuzzleSchema.js";

const PUZZLE_TTL_MS = 2 * 60 * 60 * 1000;
const META_TTL_MS = 2000;
const VALID_IDS_TTL_MS = 60_000;

export const PUZZLE_LIVE_SELECT =
  "title description difficulty category type fen solutionMoves alternativeSolutions firstMoveBy captureConfig kidsConfig illegalConfig level rating";

const puzzleCache = new Map();
const metaCache = new Map();
const validIdsCache = new Map();

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
    return hit.puzzle;
  }

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
    return hit.data;
  }
  return null;
}

export function setCachedCompetitionLiveMeta(competitionId, data) {
  metaCache.set(String(competitionId), { data, ts: Date.now() });
}

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
