import LearningChapter from "../models/LearningChapter.js";
import {
  getChapterProgressForUser,
  getProgressMapForUser,
} from "./progress.service.js";
import { calculatePercent } from "../utils/helpers.js";

export async function isChapterUnlocked(userId, chapter) {
  if (!chapter.prerequisiteChapterId) {
    return { unlocked: true };
  }

  const prereq = await LearningChapter.findById(chapter.prerequisiteChapterId).lean();
  if (!prereq) {
    return { unlocked: true };
  }

  const { percent } = await getChapterProgressForUser(userId, prereq._id);
  const required = chapter.requiredCompletionPercent ?? 100;

  if (percent >= required) {
    return { unlocked: true };
  }

  return {
    unlocked: false,
    reason: `Complete "${prereq.title}" first (${percent}% / ${required}% required)`,
    prerequisiteSlug: prereq.slug,
  };
}

export function isExerciseUnlocked(exercise, orderedExercises, progressMap) {
  const index = orderedExercises.findIndex((e) => String(e._id) === String(exercise._id));
  if (index <= 0) return true;

  const prev = orderedExercises[index - 1];
  const prevProgress = progressMap[String(prev._id)];
  return prevProgress && (prevProgress.status === "COMPLETED" || prevProgress.status === "MASTERED");
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
