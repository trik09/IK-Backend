/**
 * Shared quiz list filters used by the public quiz library and the
 * exam-creation pool endpoint.
 */
export function applyQuizTypeFilter(query, type) {
  if (!type || type === "all") return query;

  if (type === "text_mcq") {
    query.type = "mcq";
    query.isBoardBased = { $ne: true };
    return query;
  }

  if (type === "board_mcq") {
    query.type = "mcq";
    query.isBoardBased = true;
    return query;
  }

  query.type = type;
  return query;
}
