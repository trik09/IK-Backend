import {
  getChapterProgressForUser,
  getProgressMapForUser,
} from "./progress.service.js";
import { calculatePercent } from "../utils/helpers.js";

export async function isChapterUnlocked(_userId, _chapter) {
  // All chapters are freely accessible — no prerequisite gating (Lichess-style open navigation).
  return { unlocked: true };
}

export function isExerciseUnlocked(_exercise, _orderedExercises, _progressMap) {
  // All exercises within a chapter are freely accessible in any order.
  return true;
}

export async function enrichExercisesWithLockState(userId, exercises) {
  const progressMap = await getProgressMapForUser(
    userId,
    exercises.map((e) => e._id)
  );

  return exercises.map((exercise, index) => {
    const progress = progressMap[String(exercise._id)];
    const locked = !isExerciseUnlocked(exercise, exercises, progressMap);
    return {
      id: exercise._id,
      title: exercise.title,
      order: exercise.order,
      difficulty: exercise.difficulty,
      puzzleType: exercise.puzzleType,
      status: progress?.status || "NOT_STARTED",
      stars: progress?.bestScore || 0,
      locked,
    };
  });
}

export async function getSectionProgressSummary(userId, sectionId, chapters) {
  let totalExercises = 0;
  let completedExercises = 0;

  for (const chapter of chapters) {
    const { total, completed } = await getChapterProgressForUser(userId, chapter._id);
    totalExercises += total;
    completedExercises += completed;
  }

  return calculatePercent(completedExercises, totalExercises);
}
