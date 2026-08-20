import LearningSection from "../models/LearningSection.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import {
  getOverallProgress,
  getChapterProgressForUser,
  upsertExerciseProgress,
  recordAttempt,
  resetUserProgress,
} from "../services/progress.service.js";
import {
  isChapterUnlocked,
  enrichExercisesWithLockState,
  getSectionProgressSummary,
} from "../services/unlock.service.js";
import {
  validateMoveAtIndex,
  validateFullSolution,
} from "../services/exerciseValidation.service.js";
import { stripExerciseForUser } from "../utils/helpers.js";
import {
  buildCaptureConfigForLearning,
  resolveLearningPuzzleType,
} from "../utils/captureConfig.js";
import { isFailureRuleTriggered } from "../utils/learningValidation.js";

const publishedSectionQuery = { status: "published", isActive: true };
const publishedChapterQuery = { status: "published", isActive: true };
const publishedExerciseQuery = { status: "published", isActive: true };

export const getLearningDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    const overallProgress = await getOverallProgress(userId);

    const sections = await LearningSection.find(publishedSectionQuery)
      .sort({ order: 1 })
      .lean();

    const sectionsWithChapters = await Promise.all(
      sections.map(async (section) => {
        const chapters = await LearningChapter.find({
          ...publishedChapterQuery,
          sectionId: section._id,
        })
          .sort({ order: 1 })
          .lean();

        const chaptersEnriched = await Promise.all(
          chapters.map(async (chapter) => {
            const unlock = await isChapterUnlocked(userId, chapter);
            const { percent, progressMap } = await getChapterProgressForUser(
              userId,
              chapter._id
            );

            const starsList = Object.values(progressMap)
              .map((p) => p.bestScore)
              .filter(Boolean);
            const stars =
              starsList.length > 0
                ? Math.round(starsList.reduce((a, b) => a + b, 0) / starsList.length)
                : 0;

            return {
              id: chapter._id,
              title: chapter.title,
              slug: chapter.slug,
              description: chapter.description,
              icon: chapter.icon,
              exerciseCount: chapter.exerciseCount,
              progressPercent: percent,
              stars,
              unlocked: unlock.unlocked,
              unlockReason: unlock.reason || null,
              difficulty: chapter.difficulty,
              estimatedMinutes: chapter.estimatedMinutes,
            };
          })
        );

        const sectionProgress = await getSectionProgressSummary(
          userId,
          section._id,
          chapters
        );

        return {
          id: section._id,
          title: section.title,
          slug: section.slug,
          description: section.description,
          icon: section.icon,
          progressPercent: sectionProgress,
          chapters: chaptersEnriched,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: { overallProgress, sections: sectionsWithChapters },
    });
  } catch (error) {
    console.error("getLearningDashboard error:", error);
    return res.status(500).json({ success: false, message: "Failed to load learning dashboard" });
  }
};

export const getChapterBySlug = async (req, res) => {
  try {
    const userId = req.user._id;
    const { slug } = req.params;

    const chapter = await LearningChapter.findOne({
      ...publishedChapterQuery,
      slug,
    }).lean();

    if (!chapter) {
      return res.status(404).json({ success: false, message: "Chapter not found" });
    }

    const unlock = await isChapterUnlocked(userId, chapter);
    if (!unlock.unlocked) {
      return res.status(403).json({
        success: false,
        message: unlock.reason || "Chapter is locked",
        prerequisiteSlug: unlock.prerequisiteSlug,
      });
    }

    const exercises = await LearningExercise.find({
      ...publishedExerciseQuery,
      chapterId: chapter._id,
    })
      .sort({ order: 1 })
      .lean();

    const exerciseSummaries = await enrichExercisesWithLockState(userId, exercises);
    const { percent } = await getChapterProgressForUser(userId, chapter._id);

    const section = await LearningSection.findById(chapter.sectionId)
      .select("title slug")
      .lean();

    const siblings = await LearningChapter.find({
      ...publishedChapterQuery,
      sectionId: chapter.sectionId,
    })
      .sort({ order: 1 })
      .lean();

    const sectionChapters = await Promise.all(
      siblings.map(async (sib) => {
        const sibUnlock = await isChapterUnlocked(userId, sib);
        const { percent: sibPercent } = await getChapterProgressForUser(
          userId,
          sib._id
        );
        return {
          id: sib._id,
          slug: sib.slug,
          title: sib.title,
          icon: sib.icon,
          order: sib.order,
          progressPercent: sibPercent,
          unlocked: sibUnlock.unlocked,
        };
      })
    );

    const idx = siblings.findIndex((c) => String(c._id) === String(chapter._id));

    const exercisesForPlay = exercises.map((exercise, index) => {
      const summary = exerciseSummaries[index];
      const captureConfig = buildCaptureConfigForLearning(exercise);
      const boardPuzzleType = resolveLearningPuzzleType(exercise);

      return {
        ...summary,
        description: exercise.description,
        fen: exercise.fen,
        sideToMove: exercise.sideToMove,
        targetSquare: exercise.targetSquare || captureConfig?.targets?.[0]?.square || null,
        targetSquares:
          exercise.targetSquares?.length > 0
            ? exercise.targetSquares
            : captureConfig?.targets?.map((t) => t.square) || [],
        optimalMoveCount: exercise.optimalMoveCount,
        hintArrows: exercise.hintArrows || [],
        validationRules: exercise.validationRules || null,
        requiresPromotion: !!exercise.requiresPromotion,
        solutionMoves: exercise.solutionMoves,
        alternativeSolutions: exercise.alternativeSolutions,
        playerPieces: exercise.playerPieces?.length
          ? exercise.playerPieces
          : captureConfig?.playerPieces || [],
        captureConfig,
        boardPuzzleType,
        hintsEnabled: exercise.hintsEnabled,
        maxHints: exercise.maxHints,
        failureMessage: exercise.failureMessage,
        successMessage: exercise.successMessage,
        explanation: exercise.explanation,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        section: section
          ? { id: section._id, title: section.title, slug: section.slug }
          : null,
        sectionChapters,
        chapter: {
          id: chapter._id,
          title: chapter.title,
          slug: chapter.slug,
          description: chapter.description,
          learningObjectives: chapter.learningObjectives,
          estimatedMinutes: chapter.estimatedMinutes,
          difficulty: chapter.difficulty,
          icon: chapter.icon,
        },
        progressPercent: percent,
        exercises: exercisesForPlay,
        navigation: {
          prevChapterSlug: idx > 0 ? siblings[idx - 1].slug : null,
          nextChapterSlug: idx < siblings.length - 1 ? siblings[idx + 1].slug : null,
        },
      },
    });
  } catch (error) {
    console.error("getChapterBySlug error:", error);
    return res.status(500).json({ success: false, message: "Failed to load chapter" });
  }
};

export const getExerciseById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const exercise = await LearningExercise.findOne({
      _id: id,
      ...publishedExerciseQuery,
    }).lean();

    if (!exercise) {
      return res.status(404).json({ success: false, message: "Exercise not found" });
    }

    const chapter = await LearningChapter.findOne({
      _id: exercise.chapterId,
      ...publishedChapterQuery,
    }).lean();

    if (!chapter) {
      return res.status(404).json({ success: false, message: "Chapter not available" });
    }

    const unlock = await isChapterUnlocked(userId, chapter);
    if (!unlock.unlocked) {
      return res.status(403).json({ success: false, message: "Chapter is locked" });
    }

    const exercises = await LearningExercise.find({
      ...publishedExerciseQuery,
      chapterId: chapter._id,
    })
      .sort({ order: 1 })
      .lean();

    const summaries = await enrichExercisesWithLockState(userId, exercises);
    const summary = summaries.find((e) => String(e.id) === String(id));
    if (summary?.locked) {
      return res.status(403).json({ success: false, message: "Complete previous exercises first" });
    }

    const safeExercise = stripExerciseForUser(exercise);
    const captureConfig = buildCaptureConfigForLearning(exercise);
    const boardPuzzleType = resolveLearningPuzzleType(exercise);
    // Include solution for client-side board validation (same pattern as puzzle pages).
    // Authoritative scoring remains on POST /complete.
    safeExercise.solutionMoves = exercise.solutionMoves;
    safeExercise.alternativeSolutions = exercise.alternativeSolutions;
    safeExercise.initialMove = exercise.initialMove;
    safeExercise.captureConfig = captureConfig;
    safeExercise.boardPuzzleType = boardPuzzleType;
    safeExercise.targetSquare =
      exercise.targetSquare || captureConfig?.targets?.[0]?.square || null;

    return res.status(200).json({
      success: true,
      data: {
        ...safeExercise,
        hintsEnabled: exercise.hintsEnabled,
        maxHints: exercise.maxHints,
        chapterSlug: chapter.slug,
        chapterTitle: chapter.title,
      },
    });
  } catch (error) {
    console.error("getExerciseById error:", error);
    return res.status(500).json({ success: false, message: "Failed to load exercise" });
  }
};

export const submitExerciseAttempt = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { move, moveIndex = 0 } = req.body;

    if (!move) {
      return res.status(400).json({ success: false, message: "Move is required" });
    }

    const exercise = await LearningExercise.findOne({
      _id: id,
      ...publishedExerciseQuery,
    });

    if (!exercise) {
      return res.status(404).json({ success: false, message: "Exercise not found" });
    }

    const result = validateMoveAtIndex(
      exercise.fen,
      exercise.solutionMoves,
      moveIndex,
      move
    );

    await recordAttempt(userId, exercise, {
      moveSequence: [move],
      correct: result.correct,
    });

    return res.status(200).json({
      success: true,
      data: {
        correct: result.correct,
        opponentMove: result.opponentMove,
        puzzleComplete: result.puzzleComplete,
        moveIndex: result.moveIndex,
        message: result.correct
          ? exercise.successMessage
          : exercise.failureMessage,
      },
    });
  } catch (error) {
    console.error("submitExerciseAttempt error:", error);
    return res.status(500).json({ success: false, message: "Failed to validate move" });
  }
};

export const completeExercise = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const {
      mistakes = 0,
      hintsUsed = 0,
      durationMs = 0,
      moveSequence = [],
      moveCount = null,
      finalFen = null,
    } = req.body;

    const exercise = await LearningExercise.findOne({
      _id: id,
      ...publishedExerciseQuery,
    });

    if (!exercise) {
      return res.status(404).json({ success: false, message: "Exercise not found" });
    }

    const isCaptureExercise =
      exercise.puzzleType === "capture" ||
      (Array.isArray(exercise.targetSquares) && exercise.targetSquares.length > 0);

    if (!isCaptureExercise && moveSequence.length > 0) {
      const validation = validateFullSolution(exercise, moveSequence);
      if (!validation.correct) {
        return res.status(400).json({
          success: false,
          message: exercise.failureMessage || "Incorrect solution",
        });
      }
    }

    if (
      finalFen &&
      exercise.validationRules &&
      isFailureRuleTriggered(finalFen, exercise.validationRules, exercise.sideToMove || "w")
    ) {
      return res.status(400).json({
        success: false,
        message: exercise.failureMessage || "Incorrect solution",
      });
    }

    if (isCaptureExercise && (moveCount == null || moveCount < 1)) {
      return res.status(400).json({
        success: false,
        message: "Move count is required to complete this exercise",
      });
    }

    const { stars, bestScore } = await upsertExerciseProgress(userId, exercise, {
      mistakes,
      hintsUsed,
      durationMs,
      moveCount,
    });

    await recordAttempt(userId, exercise, {
      moveSequence,
      correct: true,
      hintsUsed,
      durationMs,
    });

    const { percent } = await getChapterProgressForUser(userId, exercise.chapterId);

    const nextExercise = await LearningExercise.findOne({
      ...publishedExerciseQuery,
      chapterId: exercise.chapterId,
      order: { $gt: exercise.order },
    })
      .sort({ order: 1 })
      .select("_id title order")
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        exerciseStatus: stars === 3 ? "MASTERED" : "COMPLETED",
        stars,
        bestScore,
        explanation: exercise.explanation,
        successMessage: exercise.successMessage,
        nextExerciseId: nextExercise?._id || null,
        chapterProgressPercent: percent,
      },
    });
  } catch (error) {
    console.error("completeExercise error:", error);
    return res.status(500).json({ success: false, message: "Failed to complete exercise" });
  }
};

export const requestExerciseHint = async (req, res) => {
  try {
    const { id } = req.params;
    const { level = 1 } = req.body;

    const exercise = await LearningExercise.findOne({
      _id: id,
      ...publishedExerciseQuery,
    }).lean();

    if (!exercise) {
      return res.status(404).json({ success: false, message: "Exercise not found" });
    }

    if (!exercise.hintsEnabled) {
      return res.status(403).json({ success: false, message: "Hints are disabled for this exercise" });
    }

    const hintKey = `level${Math.min(Math.max(level, 1), 3)}`;
    const hint = exercise.hintLevels?.[hintKey] || exercise.hintLevels?.level2 || "Look carefully at the pieces.";

    return res.status(200).json({ success: true, data: { hint, level } });
  } catch (error) {
    console.error("requestExerciseHint error:", error);
    return res.status(500).json({ success: false, message: "Failed to get hint" });
  }
};

export const getUserProgress = async (req, res) => {
  try {
    const overallProgress = await getOverallProgress(req.user._id);
    return res.status(200).json({ success: true, data: overallProgress });
  } catch (error) {
    console.error("getUserProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to load progress" });
  }
};

export const resetProgress = async (req, res) => {
  try {
    await resetUserProgress(req.user._id);
    return res.status(200).json({ success: true, message: "Learning progress reset" });
  } catch (error) {
    console.error("resetProgress error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset progress" });
  }
};
