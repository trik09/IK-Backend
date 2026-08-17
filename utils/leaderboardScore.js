/**
 * Redis ZSET score: more puzzles solved ranks higher; lower time ranks higher;
 * puzzle points are the last tie-breaker.
 */
export function redisScore({ puzzlesSolved = 0, timeSpent = 0, score = 0 } = {}) {
  const solved = Number(puzzlesSolved) || 0;
  const time = Number(timeSpent) || 0;
  const pts = Number(score) || 0;
  return solved * 1_000_000 - time * 1_000 + pts;
}
