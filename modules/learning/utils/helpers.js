export function slugify(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripExerciseForUser(exercise) {
  if (!exercise) return null;
  const obj = typeof exercise.toObject === "function" ? exercise.toObject() : { ...exercise };
  delete obj.solutionMoves;
  delete obj.alternativeSolutions;
  delete obj.initialMove;
  delete obj.hintLevels;
  return obj;
}

export function calculateStars(mistakes = 0, hintsUsed = 0) {
  const penalty = mistakes + hintsUsed;
  if (penalty === 0) return 3;
  if (penalty <= 2) return 2;
  return 1;
}

/**
 * Lichess Learn parity — ui/learn/src/score.ts getLevelBonus():
 *   late = actualMoves - optimalMoveCount
 *   3★ when late <= 0 (shortest path only)
 *   2★ when late <= max(1, optimalMoveCount / 8)
 *   1★ otherwise
 */
export function calculateStarsFromMoves(actualMoves, optimalMoveCount) {
  if (actualMoves == null || optimalMoveCount == null || actualMoves < 1) return 1;
  const late = actualMoves - optimalMoveCount;
  if (late <= 0) return 3;
  const tolerance = Math.max(1, optimalMoveCount / 8);
  if (late <= tolerance) return 2;
  return 1;
}

export function calculatePercent(completed, total) {
  if (!total || total === 0) return 0;
  return Math.round((completed / total) * 100);
}
