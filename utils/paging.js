export function parseLeaderboardPaging(query = {}) {
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(query.limit, 10) || 200)
  );
  const skip = Math.max(0, Number.parseInt(query.skip, 10) || 0);
  return { limit, skip };
}
