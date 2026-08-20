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

/** Lichess-style stars from move count vs optimal (Module 1). */
export function calculateStarsFromMoves(actualMoves, optimalMoveCount) {
  if (actualMoves == null || optimalMoveCount == null) return 1;
  const late = actualMoves - optimalMoveCount;
  if (late <= 0) return 3;
  const tolerance = Math.max(1, Math.floor(optimalMoveCount / 8));
  if (late <= tolerance) return 2;
  return 1;
}

export function calculatePercent(completed, total) {
  if (!total || total === 0) return 0;
  return Math.round((completed / total) * 100);
}
