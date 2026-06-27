import UserModel from "../models/UserSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import PuzzleHistoryModel from "../models/PuzzleHistorySchema.js";

/**
 * Checks if user has attempted a puzzle and updates their rating if it is the first attempt.
 * @param {string} userId
 * @param {string} puzzleId
 * @param {boolean} isSolved
 * @returns {Promise<{ ratingChanged: boolean, oldRating: number, newRating: number, delta: number, attempts: number }>}
 */
export async function recordPuzzleAttempt(userId, puzzleId, isSolved) {
  // 1. Check if attempt already exists in PuzzleHistoryModel
  const existing = await PuzzleHistoryModel.findOne({ userId, puzzleId });
  
  // Find user and puzzle
  const user = await UserModel.findById(userId);
  const puzzle = await PuzzleModel.findById(puzzleId);
  
  if (!user) {
    throw new Error("User not found");
  }
  if (!puzzle) {
    throw new Error("Puzzle not found");
  }

  const oldRating = user.puzzleRating ?? 1000;
  const attempts = user.puzzleRatingAttempts ?? 0;

  if (existing) {
    // If it's a retry or not the first attempt, we do NOT change rating
    // Increment history attempts
    existing.attempts = (existing.attempts || 1) + 1;
    await existing.save();
    
    return {
      ratingChanged: false,
      oldRating,
      newRating: oldRating,
      delta: 0,
      attempts
    };
  }

  // First attempt: update rating!
  const Rp = puzzle.rating ?? 1000; // Puzzle Rating
  const Ru = oldRating;             // User Rating

  // E = 1 / (1 + 10^((Rp - Ru)/400))
  const E = 1 / (1 + Math.pow(10, (Rp - Ru) / 400));
  const S = isSolved ? 1 : 0;

  // Determine K-factor
  let K = 32;
  if (attempts < 10) {
    K = 60;
  } else if (attempts >= 30) {
    K = 16;
  }

  const delta = Math.round(K * (S - E));
  const newRating = Math.max(100, Ru + delta);

  user.puzzleRating = newRating;
  user.puzzleRatingAttempts = attempts + 1;
  await user.save();

  // Save to PuzzleHistoryModel
  const history = new PuzzleHistoryModel({
    puzzleId,
    userId,
    isSolved,
    usedHints: 0,
    attempts: 1,
    timeTaken: 0,
  });
  await history.save();

  return {
    ratingChanged: true,
    oldRating,
    newRating,
    delta,
    attempts: user.puzzleRatingAttempts
  };
}
