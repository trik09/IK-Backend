import User from "../models/UserSchema.js";
import Puzzle from "../models/PuzzleSchema.js";
import PuzzleHistory from "../models/PuzzleHistorySchema.js";

/**
 * Calculates ELO Rating Delta & New User Rating
 */
export const calculateEloDelta = (userRating, puzzleRating, isCorrect, attemptsCount = 0) => {
  const Ru = userRating || 1000;
  const Rp = puzzleRating || 1000;
  const S = isCorrect ? 1 : 0;

  // Expected Probability (E)
  const expectedScore = 1 / (1 + Math.pow(10, (Rp - Ru) / 400));

  // Dynamic K-Factor Weightings
  let kFactor = 32;
  if (attemptsCount < 9) {
    kFactor = 60; // Provisional (Attempts 1-9)
  } else if (attemptsCount < 29) {
    kFactor = 32; // Regular (Attempts 10-29)
  } else {
    kFactor = 16; // Stable (Attempts 30+)
  }

  // Delta calculation
  const delta = Math.round(kFactor * (S - expectedScore));
  const newRating = Math.max(100, Ru + delta);

  return {
    expectedScore,
    kFactor,
    delta,
    newRating,
    userRatingBefore: Ru,
    puzzleRating: Rp
  };
};

/**
 * Processes a puzzle attempt rating update securely.
 * Enforces anti-exploit rules (Rating updates ONLY on the user's first attempt).
 */
export const processPuzzleAttemptRating = async ({ userId, puzzleId, isSolved, timeSpent = 0, usedHints = 0 }) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const puzzle = await Puzzle.findById(puzzleId);
  if (!puzzle) throw new Error("Puzzle not found");

  // Determine puzzle target rating (fallback to level-based calculation if unrated)
  let puzzleRating = puzzle.rating;
  if (!puzzleRating || puzzleRating < 300) {
    const level = puzzle.level || 1;
    puzzleRating = 600 + (level - 1) * 200;
  }

  // Check if user has already attempted this puzzle before
  const existingHistory = await PuzzleHistory.findOne({ userId, puzzleId });
  const isFirstAttempt = !existingHistory;

  let delta = 0;
  let userRatingBefore = user.puzzleRating || 1000;
  let userRatingAfter = userRatingBefore;
  let kFactor = 32;

  if (isFirstAttempt) {
    // Calculate ELO Delta using user's total attempt count
    const eloResult = calculateEloDelta(
      userRatingBefore,
      puzzleRating,
      isSolved,
      user.puzzleAttemptsCount || 0
    );

    delta = eloResult.delta;
    userRatingAfter = eloResult.newRating;
    kFactor = eloResult.kFactor;

    // Update user stats atomically
    user.puzzleRating = userRatingAfter;
    user.puzzleAttemptsCount = (user.puzzleAttemptsCount || 0) + 1;
    if (isSolved) {
      user.puzzleSolvedCount = (user.puzzleSolvedCount || 0) + 1;
    } else {
      user.puzzleFailedCount = (user.puzzleFailedCount || 0) + 1;
    }
    await user.save();

    // Create history entry
    await PuzzleHistory.create({
      userId,
      puzzleId,
      isSolved,
      usedHints,
      timeTaken: timeSpent,
      isFirstAttempt: true,
      userRatingBefore,
      userRatingAfter,
      puzzleRating,
      ratingDelta: delta,
      kFactor
    });
  } else {
    // Replay attempt — record history log without altering user ELO rating
    await PuzzleHistory.create({
      userId,
      puzzleId,
      isSolved,
      usedHints,
      timeTaken: timeSpent,
      isFirstAttempt: false,
      userRatingBefore,
      userRatingAfter: userRatingBefore,
      puzzleRating,
      ratingDelta: 0,
      kFactor: 0
    });
  }

  return {
    isFirstAttempt,
    userRatingBefore,
    userRatingAfter,
    delta,
    kFactor,
    puzzleRating,
    totalAttempts: user.puzzleAttemptsCount || 0,
    solvedCount: user.puzzleSolvedCount || 0,
    failedCount: user.puzzleFailedCount || 0
  };
};
