export const VAR4_ROTATING_POOL = [
  'Pawn Endgame',
  'Fork',
  'Skewer',
  'Opening Traps',
  'Pin',
  'Rook Endgame',
  'Overloading',
  'Discover Attack',
  'Mate in Two',
];

const normalizeCombo = (categories) =>
  [...categories].sort((a, b) => a.localeCompare(b)).join('|');

const shuffleArray = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const getCombinations = (items, size) => {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  const [first, ...rest] = items;
  const withFirst = getCombinations(rest, size - 1).map((combo) => [first, ...combo]);
  const withoutFirst = getCombinations(rest, size);
  return [...withFirst, ...withoutFirst];
};

const buildLastUsedAtMap = (entries = []) => {
  const lastUsedAt = {};
  entries.forEach((entry) => {
    (entry.rotatingCategories || []).forEach((category) => {
      if (!lastUsedAt[category]) {
        lastUsedAt[category] = entry.generatedAt;
      }
    });
  });
  return lastUsedAt;
};

const scoreCombo = (
  categories,
  { lastCombo, lastArenaCategories, cycleUsedCategories, lastUsedAt },
) => {
  const comboKey = normalizeCombo(categories);
  if (lastCombo && comboKey === lastCombo) {
    return Number.POSITIVE_INFINITY;
  }

  let score = 0;
  categories.forEach((category) => {
    if (cycleUsedCategories.has(category)) score += 1_000_000;
    if (lastArenaCategories.has(category)) score += 100_000;
    const lastUsed = lastUsedAt[category];
    if (lastUsed) {
      score += new Date(lastUsed).getTime();
    } else {
      score -= 1_000_000_000;
    }
  });

  return score;
};

export const selectRotatingCategories = (
  history = {},
  pool = VAR4_ROTATING_POOL,
) => {
  const entries = history.entries || [];
  const lastEntry = entries[0];
  const lastCombo = lastEntry?.rotatingCategories
    ? normalizeCombo(lastEntry.rotatingCategories)
    : null;
  const lastArenaCategories = new Set(lastEntry?.rotatingCategories || []);
  const lastUsedAt = buildLastUsedAtMap(entries);

  let cycleUsedCategories = new Set(history.cycleUsedCategories || []);
  const cycleComplete = pool.every((category) => cycleUsedCategories.has(category));
  if (cycleComplete) {
    cycleUsedCategories = new Set();
  }

  const combos = getCombinations(pool, 3);
  if (combos.length === 0) {
    return shuffleArray(pool.slice(0, 3));
  }

  const scored = combos
    .map((categories) => ({
      categories,
      score: scoreCombo(categories, {
        lastCombo,
        lastArenaCategories,
        cycleUsedCategories,
        lastUsedAt,
      }),
    }))
    .filter((item) => Number.isFinite(item.score));

  const candidateCombos =
    scored.length > 0
      ? scored
      : combos.map((categories) => ({
          categories,
          score: scoreCombo(categories, {
            lastCombo: null,
            lastArenaCategories,
            cycleUsedCategories,
            lastUsedAt,
          }),
        }));

  const minScore = Math.min(...candidateCombos.map((item) => item.score));
  const topCombos = candidateCombos.filter((item) => item.score === minScore);
  const chosen =
    topCombos[Math.floor(Math.random() * topCombos.length)]?.categories ||
    shuffleArray(pool).slice(0, 3);

  return shuffleArray(chosen);
};

export const buildNextCycleUsedCategories = (
  currentCycleUsed = [],
  rotatingCategories = [],
  pool = VAR4_ROTATING_POOL,
) => {
  const next = new Set(currentCycleUsed);
  rotatingCategories.forEach((category) => next.add(category));

  if (pool.every((category) => next.has(category))) {
    return [];
  }

  return [...next];
};
