import mongoose from "mongoose";
import PuzzleModel from "../models/PuzzleSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";

/**
 * Returns valid (non-deleted) puzzle IDs for a competition/event.
 */
export async function getValidPuzzleIds(rawPuzzleIds = []) {
  const uniquePuzzleIds = [...new Set(rawPuzzleIds.map((id) => id.toString()))];
  if (uniquePuzzleIds.length === 0) return [];

  const existingPuzzleDocs = await PuzzleModel.find(
    { _id: { $in: uniquePuzzleIds } },
    { _id: 1 }
  ).lean();

  const existingPuzzleIdSet = new Set(existingPuzzleDocs.map((p) => p._id.toString()));
  return uniquePuzzleIds.filter((id) => existingPuzzleIdSet.has(id));
}

/**
 * Returns puzzle IDs the user has not yet attempted (no PuzzleAttempt row).
 */
export async function getUnattemptedPuzzleIds(competitionOrEventId, userId, rawPuzzleIds = []) {
  const validPuzzleIds = await getValidPuzzleIds(rawPuzzleIds);
  if (validPuzzleIds.length === 0) return [];

  const attemptedDocs = await PuzzleAttemptModel.find({
    competitionId: competitionOrEventId,
    userId,
    puzzleId: { $in: validPuzzleIds },
  })
    .select("puzzleId")
    .lean();

  const attemptedPuzzleIds = new Set(attemptedDocs.map((a) => a.puzzleId.toString()));
  return validPuzzleIds.filter((id) => !attemptedPuzzleIds.has(id));
}

/**
 * Build a 200 OK idempotent response when a puzzle was already solved/failed.
 */
export function buildIdempotentAttemptResponse(existingAttempt, participant) {
  const isSolved = existingAttempt.status === "solved";
  return {
    success: true,
    idempotent: true,
    isCorrect: isSolved,
    scoreEarned: existingAttempt.scoreEarned || 0,
    totalScore: participant?.score || 0,
    puzzlesSolved: participant?.puzzlesSolved || 0,
    puzzleStatus: existingAttempt.status,
    message: `Puzzle already ${existingAttempt.status}`,
  };
}

/**
 * Atomically mark an attempt solved/failed. Returns null if already terminal.
 */
export async function upsertTerminalAttempt(filter, updateFields) {
  try {
    return await PuzzleAttemptModel.findOneAndUpdate(
      {
        ...filter,
        status: { $nin: ["solved", "failed"] },
      },
      { $set: updateFields },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Concurrent upsert race — caller should treat as idempotent (no double score)
    if (err.code === 11000) return null;
    throw err;
  }
}

/**
 * Sum timeSpent across all puzzle attempts for a competition/event participant.
 * Returns seconds. Skips implausible values (e.g. unix timestamps stored as durations).
 */
export async function calcTotalSolveTime(competitionId, userId) {
  try {
    if (!competitionId || !userId) return 0;

    const compOid =
      competitionId instanceof mongoose.Types.ObjectId
        ? competitionId
        : new mongoose.Types.ObjectId(String(competitionId));
    const userOid =
      userId instanceof mongoose.Types.ObjectId
        ? userId
        : new mongoose.Types.ObjectId(String(userId));

    const attempts = await PuzzleAttemptModel.find({
      competitionId: compOid,
      userId: userOid,
      status: { $in: ["solved", "failed"] },
    })
      .select("timeSpent")
      .lean();

    return attempts.reduce((sum, attempt) => {
      const seconds = Number(attempt.timeSpent) || 0;
      if (seconds <= 0 || seconds > MAX_PLAUSIBLE_SOLVE_SECONDS) return sum;
      return sum + seconds;
    }, 0);
  } catch (err) {
    console.error(
      `[calcTotalSolveTime] error for ${competitionId}, ${userId}:`,
      err
    );
    return 0;
  }
}

/** Longer than any realistic competition; unix epoch seconds are ~1.7e9+. */
export const MAX_PLAUSIBLE_SOLVE_SECONDS = 24 * 60 * 60;

/** Drop corrupt stored durations (unix timestamps, etc.) to 0 for leaderboard math. */
export function sanitizeStoredSolveSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PLAUSIBLE_SOLVE_SECONDS) return 0;
  return Math.floor(n);
}

/** Normalize per-puzzle seconds from the client. */
export function normalizePuzzleTimeSpent(timeSpent) {
  const seconds = Number(timeSpent);
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  // Reject unix-timestamp / clock bugs so they are never stored as durations.
  if (seconds > MAX_PLAUSIBLE_SOLVE_SECONDS) return 1;
  return Math.floor(seconds);
}

/**
 * Save PuzzleSolution, ignoring duplicate-key races.
 */
export async function savePuzzleSolutionSafe(PuzzleSolutionModel, doc) {
  try {
    await new PuzzleSolutionModel(doc).save();
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}
