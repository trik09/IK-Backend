import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const createRateLimiter = ({
  windowMs,
  max,
  message,
  keyPrefix,
  identifierFromReq,
}) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const identifierRaw =
        (typeof identifierFromReq === "function" ? identifierFromReq(req) : "") ??
        "";
      const identifier = String(identifierRaw).trim().toLowerCase();
      const ipKey = ipKeyGenerator(req);
      return `${keyPrefix}:${ipKey}:${identifier}`;
    },
    handler: (req, res, _next, options) => {
      const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
      return res.status(429).json({
        message,
        retryAfterSeconds,
      });
    },
  });
};

export const userLoginRateLimiter = createRateLimiter({
  windowMs: 1000,
  max: 3,
  message: "Too many login attempts. Please try again later.",
  keyPrefix: "rl:user-login",
  identifierFromReq: (req) => req.body?.email,
});

export const adminLoginRateLimiter = createRateLimiter({
  windowMs: 1000,
  max: 3,
  message: "Too many admin login attempts. Please try again later.",
  keyPrefix: "rl:admin-login",
  identifierFromReq: (req) => req.body?.email,
});

/** Soft limits on hot live GET paths (per user + competition/event). */
export const liveLeaderboardRateLimiter = createRateLimiter({
  windowMs: 10_000,
  max: 6,
  message: "Too many leaderboard requests. Please slow down.",
  keyPrefix: "rl:live-leaderboard",
  identifierFromReq: (req) =>
    `${req.user?._id || "anon"}:${req.params.competitionId || req.params.eventId || "unknown"}`,
});

export const liveLobbyRateLimiter = createRateLimiter({
  windowMs: 10_000,
  max: 20,
  message: "Too many lobby-state requests. Please slow down.",
  keyPrefix: "rl:live-lobby",
  identifierFromReq: (req) =>
    `${req.user?._id || "anon"}:${req.params.competitionId || req.params.eventId || "unknown"}`,
});

export const liveParticipateRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many join attempts. Please wait and try again.",
  keyPrefix: "rl:live-participate",
  identifierFromReq: (req) =>
    `${req.user?._id || "anon"}:${req.params.competitionId || req.params.eventId || "unknown"}`,
});
