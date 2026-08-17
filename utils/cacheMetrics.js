const metrics = {
  competitionLeaderboard: { hits: 0, misses: 0 },
  eventLeaderboard: { hits: 0, misses: 0 },
  examMeta: { hits: 0, misses: 0 },
  puzzleCache: { hits: 0, misses: 0 },
  competitionLite: { hits: 0, misses: 0 },
  competitionLiveMeta: { hits: 0, misses: 0 },
};

export const recordHit = (cacheName) => {
  if (metrics[cacheName]) {
    metrics[cacheName].hits += 1;
  }
};

export const recordMiss = (cacheName) => {
  if (metrics[cacheName]) {
    metrics[cacheName].misses += 1;
  }
};

export const getMetrics = () => {
  const result = {};
  for (const [name, data] of Object.entries(metrics)) {
    const total = data.hits + data.misses;
    result[name] = {
      hits: data.hits,
      misses: data.misses,
      hitRate: total > 0 ? `${((data.hits / total) * 100).toFixed(2)}%` : "0%",
    };
  }
  return result;
};

export const resetMetrics = () => {
  for (const key of Object.keys(metrics)) {
    metrics[key] = { hits: 0, misses: 0 };
  }
};
