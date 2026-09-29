const TARGET_COUNT = 10;
const MIN_ILLEGAL = 2;
const MIN_CAPTURE = 2;
const ALLOWED_LEVELS = new Set([1, 2, 3]);
const FOOD_TARGETS = new Set(["pizza", "burger"]);

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function getPuzzleId(puzzle) {
  return puzzle?.id || puzzle?._id;
}

function getPuzzleType(puzzle) {
  return String(puzzle?.puzzleType || puzzle?.type || "normal").toLowerCase();
}

function getLevel(puzzle) {
  const level = Number(puzzle?.level);
  return Number.isFinite(level) ? level : 1;
}

function getCategory(puzzle) {
  return String(puzzle?.category || "Uncategorized").trim() || "Uncategorized";
}

export function isIllegalPuzzle(puzzle) {
  const type = getPuzzleType(puzzle);
  const category = getCategory(puzzle).toLowerCase();
  return type === "illegal" || category.includes("illegal");
}

export function isCaptureFoodPuzzle(puzzle) {
  const type = getPuzzleType(puzzle);
  const config = puzzle?.captureConfig || puzzle?.kidsConfig;
  const targets = Array.isArray(config?.targets) ? config.targets : [];
  const hasFoodTarget = targets.some((target) =>
    FOOD_TARGETS.has(String(target?.item || "").toLowerCase()),
  );
  const title = String(puzzle?.title || "").toLowerCase();
  const looksLikeFood =
    hasFoodTarget || title.includes("pizza") || title.includes("burger");

  return (
    looksLikeFood &&
    (type === "capture" ||
      type === "kids" ||
      (targets.length > 0 && config?.mode === "objects"))
  );
}

function takeUpTo(list, count, usedIds) {
  const picked = [];
  for (const puzzle of list) {
    if (picked.length >= count) break;
    const id = String(getPuzzleId(puzzle));
    if (!id || usedIds.has(id)) continue;
    usedIds.add(id);
    picked.push(puzzle);
  }
  return picked;
}

/**
 * Pick a 10-puzzle practice set:
 * - levels 1–3 only
 * - at least 2 illegal-move puzzles
 * - at least 2 pizza/burger capture puzzles
 * - remaining slots filled with 1 puzzle per unused category
 */
export function selectPracticeDailyPuzzles(
  puzzles,
  { targetCount = TARGET_COUNT, excludeIds = [] } = {},
) {
  const excluded = new Set((excludeIds || []).map((id) => String(id)));
  const pool = shuffle(
    (puzzles || []).filter((puzzle) => {
      if (!ALLOWED_LEVELS.has(getLevel(puzzle))) return false;
      const id = String(getPuzzleId(puzzle));
      return id && !excluded.has(id);
    }),
  );

  const illegal = shuffle(pool.filter(isIllegalPuzzle));
  const capture = shuffle(pool.filter(isCaptureFoodPuzzle));
  const usedIds = new Set();
  const selected = [
    ...takeUpTo(illegal, MIN_ILLEGAL, usedIds),
    ...takeUpTo(capture, MIN_CAPTURE, usedIds),
  ];

  const usedCategories = new Set(selected.map(getCategory));
  const remainingByCategory = new Map();
  for (const puzzle of pool) {
    const id = String(getPuzzleId(puzzle));
    if (!id || usedIds.has(id)) continue;
    const category = getCategory(puzzle);
    if (!remainingByCategory.has(category)) {
      remainingByCategory.set(category, []);
    }
    remainingByCategory.get(category).push(puzzle);
  }

  const leftover = [];
  for (const [category, group] of remainingByCategory.entries()) {
    const [first, ...rest] = group;
    if (!first) continue;
    if (!usedCategories.has(category) && selected.length < targetCount) {
      usedIds.add(String(getPuzzleId(first)));
      usedCategories.add(category);
      selected.push(first);
      leftover.push(...rest);
    } else {
      leftover.push(...group);
    }
  }

  if (selected.length < targetCount) {
    selected.push(...takeUpTo(shuffle(leftover), targetCount - selected.length, usedIds));
  }

  // If excluding yesterday left the pool too small, fill from excluded puzzles.
  if (selected.length < targetCount && excluded.size > 0) {
    const fallback = shuffle(
      (puzzles || []).filter((puzzle) => ALLOWED_LEVELS.has(getLevel(puzzle))),
    );
    selected.push(...takeUpTo(fallback, targetCount - selected.length, usedIds));
  }

  return selected.slice(0, targetCount);
}
