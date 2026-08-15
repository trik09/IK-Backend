/** Log slow live-arena requests for observability (P4). */
export const liveSlowLogMiddleware = (thresholdMs = 500) => (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration >= thresholdMs) {
      console.warn(
        `[LiveSlow] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms user=${req.user?._id || "anon"}`
      );
    }
  });
  next();
};
