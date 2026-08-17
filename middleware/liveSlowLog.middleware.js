/** Log slow live-arena requests for observability (P4). */
export const liveSlowLogMiddleware = (thresholdMs = 500) => (req, res, next) => {
  const start = Date.now();
  const requestId = req.headers["x-request-id"] || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration >= thresholdMs) {
      console.warn(
        JSON.stringify({
          msg: "LiveSlow",
          requestId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs: duration,
          user: req.user?._id || "anon",
        })
      );
    }
  });
  next();
};
