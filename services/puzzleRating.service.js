import UserModel from "../models/UserSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import PuzzleHistoryModel from "../models/PuzzleHistorySchema.js";
import ThemeModel from "../models/ThemeSchema.js";
import { calculateDualGlicko2 } from "./glicko2.service.js";
import { invalidateAuthUserCache } from "../utils/userAuthCache.js";

/**
 * Calculates dynamic target rating range based on user's current puzzle rating
 */
export const getTargetRatingRange = (userRating = 400, difficulty = 'standard') => {
  const r = Math.max(100, Math.round(userRating));
  const diff = String(difficulty || 'standard').toLowerCase();

  switch (diff) {
    case 'easy':
      return {
        min: Math.max(100, r - 200),
        max: Math.max(100, r - 100),
        label: 'Easy'
      };
    case 'hard':
      return {
        min: Math.max(100, r + 100),
        max: Math.max(100, r + 200),
        label: 'Hard'
      };
    case 'standard':
    default:
      return {
        min: Math.max(100, r - 100),
        max: Math.max(100, r + 100),
        label: 'Standard'
      };
  }
};

/**
 * Selects an adaptive puzzle for a user based on Glicko-2 rating, difficulty, and theme.
 * Progressively expands search window if target range is scarce.
 */
export const getAdaptivePuzzle = async (userId = null, options = {}) => {
  const { difficulty = 'standard', theme = 'all', currentRating, targetRating, excludeId, excludeIds } = options;

  let userRating = 400;
  let userRD = 350;
  let userVolatility = 0.06;
  let solvedPuzzleIds = [];

  if (userId) {
    const user = await UserModel.findById(userId).select('puzzleRating puzzleRD puzzleVolatility').lean();
    if (user) {
      userRating = user.puzzleRating ?? 400;
      userRD = user.puzzleRD ?? 350;
      userVolatility = user.puzzleVolatility ?? 0.06;
    }

    const solvedHistory = await PuzzleHistoryModel.find({ userId, isSolved: true })
      .select('puzzleId')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    solvedPuzzleIds = solvedHistory.map(h => h.puzzleId);
  }

  // Override with session/cached rating if supplied by frontend
  if (currentRating != null && !isNaN(Number(currentRating))) {
    userRating = Math.max(100, Math.round(Number(currentRating)));
  } else if (targetRating != null && !isNaN(Number(targetRating))) {
    userRating = Math.max(100, Math.round(Number(targetRating)));
  }

  // Collect all excluded puzzle IDs (currently active + session history)
  const sessionExcluded = [];
  if (excludeId) sessionExcluded.push(String(excludeId));
  if (Array.isArray(excludeIds)) sessionExcluded.push(...excludeIds.map(String));
  else if (typeof excludeIds === 'string') sessionExcluded.push(...excludeIds.split(',').map(s => s.trim()));

  const allExcludedIds = [...new Set([...solvedPuzzleIds.map(String), ...sessionExcluded])];

  const { min: targetMin, max: targetMax } = getTargetRatingRange(userRating, difficulty);

  // Theme filtering
  let themeFilter = {};
  let activeThemeDoc = null;
  const isThemeSelected = theme && theme !== 'all' && theme !== 'random';

  if (isThemeSelected) {
    activeThemeDoc = await ThemeModel.findOne({
      $or: [
        { slug: theme.trim() },
        { name: theme.trim() },
        ...(theme.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: theme }] : [])
      ],
      isActive: true
    }).lean();

    if (activeThemeDoc && Array.isArray(activeThemeDoc.puzzles) && activeThemeDoc.puzzles.length > 0) {
      themeFilter = { _id: { $in: activeThemeDoc.puzzles } };
    }
  }

  // Progressive search windows
  const searchWindows = [
    { min: targetMin, max: targetMax },
    { min: Math.max(100, targetMin - 75), max: targetMax + 75 },
    { min: Math.max(100, targetMin - 150), max: targetMax + 150 },
    { min: Math.max(100, targetMin - 300), max: targetMax + 300 },
    { min: 0, max: 5000 } // Catch-all fallback
  ];

  let selectedPuzzle = null;

  for (const win of searchWindows) {
    const baseQuery = {
      type: 'normal',
      ...themeFilter,
      $or: [
        { puzzleRating: { $gte: win.min, $lte: win.max } },
        { rating: { $gte: win.min, $lte: win.max } },
        { puzzleRating: { $exists: false }, rating: { $exists: false } }
      ]
    };

    // 1. Try excluding all solved and session-encountered puzzles
    let candidates = await PuzzleModel.find({
      ...baseQuery,
      _id: { ...(themeFilter._id ? themeFilter._id : {}), $nin: allExcludedIds }
    })
      .select('-__v')
      .limit(30)
      .lean();

    // 2. If no candidate found in this window, at least exclude the immediate current puzzle
    if (!candidates || candidates.length === 0) {
      candidates = await PuzzleModel.find({
        ...baseQuery,
        _id: { ...(themeFilter._id ? themeFilter._id : {}), $nin: sessionExcluded }
      })
        .select('-__v')
        .limit(25)
        .lean();
    }

    // 3. Last resort in this window
    if (!candidates || candidates.length === 0) {
      candidates = await PuzzleModel.find(baseQuery)
        .select('-__v')
        .limit(20)
        .lean();
    }

    if (candidates && candidates.length > 0) {
      // Pick randomly among top candidates for variety
      const randomIndex = Math.floor(Math.random() * candidates.length);
      selectedPuzzle = candidates[randomIndex];
      break;
    }
  }

  // Absolute fallback if database has any normal puzzle
  if (!selectedPuzzle) {
    selectedPuzzle = await PuzzleModel.findOne({ type: 'normal' }).lean();
  }

  if (!selectedPuzzle) {
    return {
      puzzle: null,
      userRating,
      userRD,
      difficulty,
      theme: activeThemeDoc ? (activeThemeDoc.title || activeThemeDoc.name) : 'All Themes'
    };
  }

  // Sanitize puzzle: HIDE exact puzzle rating before user solves (Lichess/Chess.com standard)
  const safePuzzle = {
    _id: selectedPuzzle._id,
    id: selectedPuzzle._id,
    title: selectedPuzzle.title,
    fen: selectedPuzzle.fen,
    solution: selectedPuzzle.solutionMoves || selectedPuzzle.solution || selectedPuzzle.moves || [],
    solutionMoves: selectedPuzzle.solutionMoves || selectedPuzzle.solution || selectedPuzzle.moves || [],
    alternativeSolutions: selectedPuzzle.alternativeSolutions || [],
    firstMoveBy: selectedPuzzle.firstMoveBy || "w",
    type: selectedPuzzle.type || "normal",
    puzzleType: selectedPuzzle.type || "normal",
    difficulty: selectedPuzzle.difficulty,
    captureConfig: selectedPuzzle.captureConfig,
    illegalConfig: selectedPuzzle.illegalConfig,
    description: selectedPuzzle.description,
    source: selectedPuzzle.source,
    tags: selectedPuzzle.tags,
    puzzleRating: null // Concealed before solving!
  };

  return {
    puzzle: safePuzzle,
    userRating,
    userRD,
    isProvisional: userRD > 150,
    difficulty,
    theme: activeThemeDoc ? (activeThemeDoc.title || activeThemeDoc.name) : 'All Themes',
    themeSlug: activeThemeDoc?.slug || activeThemeDoc?.name || 'all'
  };
};

/**
 * Processes a completed puzzle attempt with full Glicko-2 dual updating, anti-abuse, and hints protection.
 */
export const processPuzzleAttemptRating = async ({
  userId,
  puzzleId,
  isSolved = false,
  timeTaken = 0,
  hintUsed = false,
  isRatedMode = true,
  movesPlayed = []
}) => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const puzzle = await PuzzleModel.findById(puzzleId);
  if (!puzzle) {
    throw new Error("Puzzle not found");
  }

  // Check if user previously solved this puzzle (for stats/audit)
  const priorSolvedAttempt = await PuzzleHistoryModel.findOne({
    userId,
    puzzleId,
    isSolved: true
  }).lean();

  const isReplay = !!priorSolvedAttempt;
  // Rated condition: Must be in Rated mode and no hints used
  const isRated = Boolean(isRatedMode) && !hintUsed;

  const userRatingBefore = user.puzzleRating ?? 400;
  const userRDBefore = user.puzzleRD ?? 350;
  const userVolatilityBefore = user.puzzleVolatility ?? 0.06;

  const puzzleRatingBefore = puzzle.puzzleRating ?? puzzle.rating ?? 1000;
  const puzzleRDBefore = puzzle.puzzleRD ?? 350;
  const puzzleVolatilityBefore = puzzle.puzzleVolatility ?? 0.06;

  let ratingDelta = 0;
  let userRatingAfter = userRatingBefore;
  let userRDAfter = userRDBefore;
  let userVolatilityAfter = userVolatilityBefore;

  let puzzleRatingAfter = puzzleRatingBefore;
  let puzzleRDAfter = puzzleRDBefore;
  let puzzleVolatilityAfter = puzzleVolatilityBefore;

  let confidenceMessage = '';

  // Always compute Glicko-2 simulation
  const glickoResult = calculateDualGlicko2(
    { rating: userRatingBefore, rd: userRDBefore, volatility: userVolatilityBefore },
    { rating: puzzleRatingBefore, rd: puzzleRDBefore, volatility: puzzleVolatilityBefore },
    isSolved
  );

  ratingDelta = glickoResult.user.ratingChange;
  if (isSolved && ratingDelta <= 0) {
    ratingDelta = 1;
  } else if (!isSolved && ratingDelta >= 0) {
    ratingDelta = -1;
  }

  if (isRated) {
    userRatingAfter = Math.max(100, userRatingBefore + ratingDelta);
    userRDAfter = glickoResult.user.rd;
    userVolatilityAfter = glickoResult.user.volatility;

    puzzleRatingAfter = glickoResult.puzzle.rating;
    puzzleRDAfter = glickoResult.puzzle.rd;
    puzzleVolatilityAfter = glickoResult.puzzle.volatility;

    // Update User Document
    user.puzzleRating = userRatingAfter;
    user.puzzleRD = userRDAfter;
    user.puzzleVolatility = userVolatilityAfter;
    user.puzzleAttemptsCount = (user.puzzleAttemptsCount || 0) + 1;
    if (isSolved) {
      user.puzzleSolvedCount = (user.puzzleSolvedCount || 0) + 1;
      user.currentPuzzleStreak = (user.currentPuzzleStreak || 0) + 1;
      if (user.currentPuzzleStreak > (user.highestPuzzleStreak || 0)) {
        user.highestPuzzleStreak = user.currentPuzzleStreak;
      }
    } else {
      user.puzzleFailedCount = (user.puzzleFailedCount || 0) + 1;
      user.currentPuzzleStreak = 0;
    }
    user.lastRatedPuzzleAt = new Date();
    await user.save();
    invalidateAuthUserCache(userId);

    // Update Puzzle Document (Adaptive calibration)
    puzzle.puzzleRating = puzzleRatingAfter;
    puzzle.puzzleRD = puzzleRDAfter;
    puzzle.puzzleVolatility = puzzleVolatilityAfter;
    puzzle.attemptCount = (puzzle.attemptCount || 0) + 1;
    if (isSolved) {
      puzzle.solveCount = (puzzle.solveCount || 0) + 1;
    } else {
      puzzle.failureCount = (puzzle.failureCount || 0) + 1;
    }
    puzzle.lastRatedAt = new Date();
    await puzzle.save();

    if (userRDBefore > 150) {
      confidenceMessage = "Dynamic rating shift because your rating is still provisional.";
    } else {
      confidenceMessage = "Rating change calculated precisely based on your established rating.";
    }
  } else {
    if (!isRatedMode) {
      confidenceMessage = "Unrated Mode: Practice session. Your permanent rating remains unchanged.";
    } else if (hintUsed) {
      confidenceMessage = "Unrated attempt: Hints or solution assistance was requested.";
    }
  }

  // Create attempt audit record
  const attemptRecord = await PuzzleHistoryModel.create({
    userId,
    puzzleId,
    isSolved,
    isFirstAttempt: !isReplay,
    usedHints: hintUsed,
    ratingDelta: isRated ? ratingDelta : 0,
    kFactor: userRDBefore,
    userRatingBefore,
    userRatingAfter,
    puzzleRating: puzzleRatingBefore,
    puzzleRatingAfter,
    timeTaken,
    movesPlayed: movesPlayed || []
  });

  return {
    success: true,
    isSolved,
    isRated,
    isReplay,
    hintUsed,
    ratingDelta: isRated ? ratingDelta : 0,
    simulatedDelta: ratingDelta,
    ratingBefore: userRatingBefore,
    ratingAfter: userRatingAfter,
    rdBefore: userRDBefore,
    rdAfter: userRDAfter,
    isProvisional: userRDAfter > 150,
    revealedPuzzleRating: puzzleRatingBefore,
    newPuzzleRating: puzzleRatingAfter,
    confidenceMessage,
    attemptId: attemptRecord._id
  };
};
