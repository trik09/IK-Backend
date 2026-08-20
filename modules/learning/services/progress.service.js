import LearningProgress from "../models/LearningProgress.js";
import LearningExercise from "../models/LearningExercise.js";
import { calculatePercent, calculateStars, calculateStarsFromMoves } from "../utils/helpers.js";

export async function getProgressMapForUser(userId, exerciseIds = []) {
  const query = { userId };
  if (exerciseIds.length > 0) {
    query.exerciseId = { $in: exerciseIds };
  }

  const rows = await LearningProgress.find(query).lean();
  const map = {};
  for (const row of rows) {
    map[String(row.exerciseId)] = row;
  }
  return map;
}

export async function getChapterProgressForUser(userId, chapterId) {
  const exercises = await LearningExercise.find({
    chapterId,
    status: "published",
    isActive: true,
  })
    .sort({ order: 1 })
    .select("_id order")
    .lean();

  const progressMap = await getProgressMapForUser(
    userId,
    exercises.map((e) => e._id)
  );

  const completed = exercises.filter((e) => {
    const p = progressMap[String(e._id)];
    return p && (p.status === "COMPLETED" || p.status === "MASTERED");
  }).length;

  return {
    total: exercises.length,
    completed,
    percent: calculatePercent(completed, exercises.length),
    progressMap,
  };
}

export async function upsertExerciseProgress(userId, exercise, payload = {}) {
  const { mistakes = 0, hintsUsed = 0, moveCount = null } = payload;

  let attemptStars;
  if (moveCount != null && exercise.optimalMoveCount != null) {
    attemptStars = calculateStarsFromMoves(moveCount, exercise.optimalMoveCount);
  } else {
    attemptStars = calculateStars(mistakes, hintsUsed);
  }

  const now = new Date();
  const existing = await LearningProgress.findOne({
    userId,
    exerciseId: exercise._id,
  }).lean();

  // Lichess parity: always store the latest attempt score (overwrites prior 3★).
  const bestScore = attemptStars;
  const status = attemptStars === 3 ? "MASTERED" : "COMPLETED";

  const progress = await LearningProgress.findOneAndUpdate(
    { userId, exerciseId: exercise._id },
    {
      $set: {
        chapterId: exercise.chapterId,
        status,
        mistakes,
        hintsUsed,
        bestScore,
        moveCount: moveCount ?? existing?.moveCount,
        completedAt: now,
        lastAttemptAt: now,
      },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true }
  );

  return { progress, stars: attemptStars, bestScore };
}

export async function recordAttempt(userId, exercise, attemptData) {
  const LearningAttempt = (await import("../models/LearningAttempt.js")).default;
  return LearningAttempt.create({
    userId,
    exerciseId: exercise._id,
    chapterId: exercise.chapterId,
    moveSequence: attemptData.moveSequence || [],
    correct: !!attemptData.correct,
    hintsUsed: attemptData.hintsUsed || 0,
    durationMs: attemptData.durationMs || 0,
  });
}

export async function getOverallProgress(userId) {
  const exercises = await LearningExercise.find({
    status: "published",
    isActive: true,
  })
    .select("_id chapterId")
    .lean();

  const chapters = [...new Set(exercises.map((e) => String(e.chapterId)))];
  const progressRows = await LearningProgress.find({
    userId,
    status: { $in: ["COMPLETED", "MASTERED"] },
  }).lean();

  const completedExerciseIds = new Set(progressRows.map((p) => String(p.exerciseId)));

  const completedExercises = exercises.filter((e) =>
    completedExerciseIds.has(String(e._id))
  ).length;

  const completedChapterIds = new Set();
  for (const chapterId of chapters) {
    const chapterExercises = exercises.filter((e) => String(e.chapterId) === chapterId);
    const allDone = chapterExercises.every((e) => completedExerciseIds.has(String(e._id)));
    if (allDone && chapterExercises.length > 0) {
      completedChapterIds.add(chapterId);
    }
  }

  return {
    percent: calculatePercent(completedExercises, exercises.length),
    completedChapters: completedChapterIds.size,
    totalChapters: chapters.length,
    completedExercises,
    totalExercises: exercises.length,
  };
}

export async function resetUserProgress(userId) {
  await LearningProgress.deleteMany({ userId });
  return { success: true };
}
