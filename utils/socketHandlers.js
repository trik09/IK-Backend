// ==================== Redis Implementation (Refactored) ====================

import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import mongoose from "mongoose";
import CompetitionModel from "../models/CompetitionSchema.js";
import EventModel from "../models/EventSchema.js";
import { isChatOpenForEventDay } from "./chatWindow.js";
import { checkChatSpam, containsBadLanguage, containsSlang } from "./chatModeration.js";
import ParticipantModel from "../models/ParticipantSchema.js";
import CompetitionRankingModel from "../models/CompetitionRankingSchema.js";
import { getAuthUserById } from "./userAuthCache.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import { recordHit, recordMiss, recordCounter } from "./cacheMetrics.js";
import { calcTotalSolveTime, sanitizeStoredSolveSeconds, MAX_PLAUSIBLE_SOLVE_SECONDS } from "./puzzleAttemptUtils.js";
import { redisScore } from "./leaderboardScore.js";
import { createCircuitBreaker } from "./circuitBreaker.js";
import { createSingleflight } from "./singleflight.js";
import { isPrimaryWorker } from "./processRole.js";

/* =========================================================
   MODULE STATE
========================================================= */
let _io = null;
const getIO = () => _io;
const scheduledEndTimers = new Map();
const endingCompetitions = new Set();

const LEADERBOARD_CACHE_TTL_MS = 2000;
const LEADERBOARD_STALE_MS = 15_000;
const LEADERBOARD_BROADCAST_DEBOUNCE_MS = 1000;
const LEADERBOARD_COMPLETENESS_CHECK_MS = 10_000;
const leaderboardResponseCache = new Map();
const lastLeaderboardCompletenessCheck = new Map();
const pendingLeaderboardBroadcasts = new Map();
const mongoLeaderboardBreaker = createCircuitBreaker({
  name: "mongo-leaderboard",
  failureThreshold: 3,
  resetMs: 15_000,
});
const leaderboardFlight = createSingleflight();

const getCachedLeaderboard = (competitionId, { allowStale = false } = {}) => {
  const cached = leaderboardResponseCache.get(String(competitionId));
  if (!cached) {
    recordMiss("competitionLeaderboard");
    return null;
  }
  const age = Date.now() - cached.ts;
  if (age < LEADERBOARD_CACHE_TTL_MS) {
    recordHit("competitionLeaderboard");
    return cached.data;
  }
  if (allowStale && age < LEADERBOARD_STALE_MS) {
    recordHit("competitionLeaderboard");
    return cached.data;
  }
  recordMiss("competitionLeaderboard");
  return null;
};

const setCachedLeaderboard = (competitionId, data) => {
  leaderboardResponseCache.set(String(competitionId), { data, ts: Date.now() });
};

const invalidateLeaderboardCache = (competitionId) => {
  leaderboardResponseCache.delete(String(competitionId));
};

/**
 * If Redis was created by a single join upsert, it can hide other Mongo
 * participants. Rebuild from Mongo when the counts diverge.
 */
const maybeRepairIncompleteRedis = async (competitionId, redisCount) => {
  const id = String(competitionId);
  return leaderboardFlight(`lb-repair:${id}`, async () => {
    const now = Date.now();
    const last = lastLeaderboardCompletenessCheck.get(id) || 0;
    if (now - last < LEADERBOARD_COMPLETENESS_CHECK_MS) return false;

    try {
      const mongoCount = await ParticipantModel.countDocuments({ competitionId });
      lastLeaderboardCompletenessCheck.set(id, Date.now());
      if (mongoCount > Number(redisCount || 0)) {
        await buildRedisLeaderboard(competitionId);
        invalidateLeaderboardCache(competitionId);
        return true;
      }
    } catch (err) {
      lastLeaderboardCompletenessCheck.delete(id);
      console.error(`[Leaderboard] completeness check failed for ${competitionId}:`, err);
    }
    return false;
  });
};

const emitLeaderboardUpdateDebounced = (competitionId) => {
  if (!_io) return;

  const existing = pendingLeaderboardBroadcasts.get(competitionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingLeaderboardBroadcasts.delete(competitionId);
    try {
      const leaderboard = await getCurrentLeaderboard(competitionId);
      _io
        .to(`competition_${competitionId}`)
        .emit("leaderboardUpdate", leaderboard);
    } catch (err) {
      console.error("[Leaderboard] debounced broadcast error:", err);
    }
  }, LEADERBOARD_BROADCAST_DEBOUNCE_MS);

  pendingLeaderboardBroadcasts.set(competitionId, timer);
};

/* =========================================================
   REDIS KEY HELPERS
========================================================= */
const leaderboardKey = (competitionId) => `leaderboard:${competitionId}`;
const leaderboardMetaKey = (competitionId) => `leaderboard:meta:${competitionId}`;

/* =========================================================
   CORE REDIS UPSERT
   Member = plain userId string  →  ZADD is always an UPDATE,
   never an INSERT of a duplicate.  Metadata lives in a Hash.
========================================================= */
const upsertLeaderboardEntry = async (
  competitionId,
  participant,
  { recalcSolveTime = false } = {}
) => {
  try {
    const userId =
      participant.userId?._id?.toString() ||
      participant.userId?.toString();
    if (!userId) return;

    let totalSolveTime = sanitizeStoredSolveSeconds(
      participant.totalSolveTime ?? participant.timeSpent
    );
    // Never hit Mongo on the live upsert path unless an end/rebuild explicitly asks.
    if (recalcSolveTime) {
      totalSolveTime = Math.max(
        totalSolveTime,
        await calcTotalSolveTime(competitionId, userId)
      );
    }
    const pipeline = redis.pipeline();
    pipeline.zadd(
      leaderboardKey(competitionId),
      redisScore({ ...participant, timeSpent: totalSolveTime }),
      userId
    );
    // Hash: full metadata keyed by userId
    pipeline.hset(
      leaderboardMetaKey(competitionId),
      userId,
      JSON.stringify({
        userId,
        username: participant.username || null,
        name: participant.name ||
          participant.userId?.name || null,
        avatar: participant.avatar ||
          participant.userId?.avatar || null,
        score: participant.score || 0,
        puzzlesSolved: participant.puzzlesSolved || 0,
        timeSpent: totalSolveTime,
        totalSolveTime: totalSolveTime ?? 0,
        status: participant.status || "JOINED",
        submittedAt: participant.submittedAt || null,
        joinedAt: participant.joinedAt || new Date(),
      })
    );

    await pipeline.exec();
    invalidateLeaderboardCache(competitionId);
  } catch (error) {
    console.error(
      `[Leaderboard] upsertLeaderboardEntry error for ${competitionId}:`,
      error
    );
  }
};

/* =========================================================
   BUILD LEADERBOARD IN REDIS  (on start / server restart)
 ========================================================= */
const buildRedisLeaderboard = async (competitionId) => {
  try {
    const participants = await ParticipantModel.find({ competitionId })
      .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
      .populate("userId", "name avatar")
      .lean();

    if (!participants.length) return;

        // Compute total solve time per participant from puzzle attempts
    const totalTimeAgg = await PuzzleAttemptModel.aggregate([
      { $match: { competitionId } },
      {
        $group: {
          _id: "$userId",
          total: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ["$timeSpent", 0] },
                    { $lte: ["$timeSpent", MAX_PLAUSIBLE_SOLVE_SECONDS] },
                  ],
                },
                "$timeSpent",
                0,
              ],
            },
          },
        },
      },
    ]);
    const totalTimeMap = new Map();
    totalTimeAgg.forEach(doc => {
      if (doc._id) totalTimeMap.set(doc._id.toString(), sanitizeStoredSolveSeconds(doc.total));
    });

    const pipeline = redis.pipeline();
    const key = leaderboardKey(competitionId);
    const metaKey = leaderboardMetaKey(competitionId);

    for (const p of participants) {
      if (!p.userId) continue;
      const userId = p.userId._id.toString();
      const totalSolveTime = totalTimeMap.get(userId) ?? 0;

      pipeline.zadd(key, redisScore({ ...p, timeSpent: totalSolveTime }), userId);

      pipeline.hset(
        metaKey,
        userId,
        JSON.stringify({
          userId,
          username: p.username,
          name: p.userId.name,
          avatar: p.userId.avatar,
          score: p.score || 0,
          puzzlesSolved: p.puzzlesSolved || 0,
          timeSpent: totalSolveTime,
          totalSolveTime: totalTimeMap.get(userId) ?? 0,
          status: p.status || "JOINED",
          submittedAt: p.submittedAt || null,
          joinedAt: p.joinedAt || new Date(),
        })
      );
    }

    

    await pipeline.exec();
    invalidateLeaderboardCache(competitionId);
    console.log(`Redis leaderboard built for ${competitionId}`);
  } catch (error) {
    console.error(
      `[Leaderboard] Redis build error for ${competitionId}:`,
      error
    );
  }
};

/* =========================================================
   GET LEADERBOARD  (Redis-first, short-lived cache)
 ========================================================= */
async function backfillMissingSolveTimes(competitionId, leaderboard) {
  const missing = (leaderboard || []).filter(
    (entry) =>
      !(Number(entry.totalSolveTime) > 0) &&
      ((entry.puzzlesSolved || 0) > 0 || (entry.score || 0) > 0)
  );
  if (!missing.length) return leaderboard;

  const ids = missing.map((entry) => entry.userId).filter(Boolean);
  const docs = await ParticipantModel.find({
    competitionId,
    userId: { $in: ids },
  })
    .select("userId timeSpent")
    .lean();

  const timeByUser = new Map(
    docs.map((p) => [
      String(p.userId?._id || p.userId || ""),
      sanitizeStoredSolveSeconds(p.timeSpent),
    ])
  );

  return leaderboard.map((entry) => {
    if (Number(entry.totalSolveTime) > 0) return entry;
    const fromMongo = timeByUser.get(String(entry.userId)) || 0;
    if (!fromMongo) return entry;
    return {
      ...entry,
      timeSpent: fromMongo,
      totalSolveTime: fromMongo,
    };
  });
}

const getCurrentLeaderboard = async (competitionId, limit = 200, skip = 0, { repaired = false } = {}) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const safeSkip = Math.max(0, Number(skip) || 0);
  const cached = getCachedLeaderboard(competitionId);
  if (cached) {
    if (
      !repaired &&
      cached.length < 200 &&
      (await maybeRepairIncompleteRedis(competitionId, cached.length))
    ) {
      return getCurrentLeaderboard(competitionId, limit, skip, { repaired: true });
    }
    const needsFill = cached.some(
      (entry) =>
        !(Number(entry.totalSolveTime) > 0) && (entry.puzzlesSolved || 0) > 0
    );
    const source = needsFill
      ? await backfillMissingSolveTimes(competitionId, cached)
      : cached;
    if (needsFill) setCachedLeaderboard(competitionId, source);
    return source.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
      ...entry,
      rank: safeSkip + index + 1,
    }));
  }

  const key = leaderboardKey(competitionId);
  const metaKey = leaderboardMetaKey(competitionId);

  try {
    const rangeEnd = Math.max(safeSkip + safeLimit, 200) - 1;
    const pipeResults = await redis
      .pipeline()
      .exists(key)
      .zcard(key)
      .zrevrange(key, 0, rangeEnd)
      .exec();
    const exists = Number(pipeResults?.[0]?.[1] || 0);
    const zcard = Number(pipeResults?.[1]?.[1] || 0);
    const userIds = pipeResults?.[2]?.[1] || [];

    if (exists) {
      if (!repaired && (await maybeRepairIncompleteRedis(competitionId, zcard))) {
        return getCurrentLeaderboard(competitionId, limit, skip, { repaired: true });
      }

      const cachedAfterRepair = getCachedLeaderboard(competitionId);
      if (cachedAfterRepair && cachedAfterRepair.length > (userIds?.length || 0)) {
        return cachedAfterRepair.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
          ...entry,
          rank: safeSkip + index + 1,
        }));
      }

      if (!userIds.length) {
        setCachedLeaderboard(competitionId, []);
        return [];
      }
      const metaRaws = await redis.hmget(metaKey, ...userIds);

      const leaderboard = userIds
        .map((uid, index) => {
          const metaRaw = metaRaws[index];
          if (!metaRaw) return null;
          const meta = JSON.parse(metaRaw);
          const totalSolveTime = sanitizeStoredSolveSeconds(
            meta.totalSolveTime ?? meta.timeSpent
          );

          return {
            rank: index + 1,
            userId: uid,
            username: meta.username ?? null,
            name: meta.name ?? null,
            avatar: meta.avatar ?? null,
            score: meta.score ?? 0,
            puzzlesSolved: meta.puzzlesSolved ?? 0,
            timeSpent: totalSolveTime,
            totalSolveTime,
            status: meta.status ?? "JOINED",
            submittedAt: meta.submittedAt ?? null,
            joinedAt: meta.joinedAt ?? null,
          };
        })
        .filter(Boolean);

      if (leaderboard.length) {
        const withTimes = await backfillMissingSolveTimes(competitionId, leaderboard);
        setCachedLeaderboard(competitionId, withTimes);
        return withTimes.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
          ...entry,
          rank: safeSkip + index + 1,
        }));
      }
    }
  } catch (error) {
    console.error(`[Leaderboard] Redis read error for ${competitionId}:`, error);
    const stale = getCachedLeaderboard(competitionId, { allowStale: true });
    if (stale) {
      return stale.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
        ...entry,
        rank: safeSkip + index + 1,
      }));
    }
  }

  if (mongoLeaderboardBreaker.isOpen()) {
    recordCounter("mongoFallbackBlocked");
    const stale = getCachedLeaderboard(competitionId, { allowStale: true });
    return stale
      ? stale.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
          ...entry,
          rank: safeSkip + index + 1,
        }))
      : [];
  }

  recordCounter("mongoFallback");
  console.warn(`[Leaderboard] Falling back to DB for ${competitionId}`);

  return leaderboardFlight(`lb-mongo:${competitionId}`, async () => {
    const fromCache = getCachedLeaderboard(competitionId);
    if (fromCache) {
      return fromCache.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
        ...entry,
        rank: safeSkip + index + 1,
      }));
    }

    return mongoLeaderboardBreaker.exec(
      async () => {
        const participants = await ParticipantModel.find({ competitionId })
          .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
          .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1, joinedAt: 1 })
          .limit(500)
          .lean();

        const leaderboard = participants.map((p, index) => {
          const uid = p.userId?._id?.toString() || p.userId?.toString();
          const totalSolveTime = sanitizeStoredSolveSeconds(p.timeSpent);
          return {
            rank: index + 1,
            userId: uid,
            username: p.username,
            name: null,
            avatar: null,
            score: p.score || 0,
            puzzlesSolved: p.puzzlesSolved || 0,
            timeSpent: totalSolveTime,
            totalSolveTime,
            status: p.status,
            submittedAt: p.submittedAt || null,
            joinedAt: p.joinedAt,
          };
        });

        if (leaderboard.length) {
          setCachedLeaderboard(competitionId, leaderboard);
        }

        setImmediate(async () => {
          try {
            const exists = await redis.exists(key);
            if (!exists) await buildRedisLeaderboard(competitionId);
          } catch (err) {
            console.error("[Leaderboard] Redis rebuild error:", err);
          }
        });

        return leaderboard.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
          ...entry,
          rank: safeSkip + index + 1,
        }));
      },
      () => {
        const stale = getCachedLeaderboard(competitionId, { allowStale: true });
        return stale
          ? stale.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
              ...entry,
              rank: safeSkip + index + 1,
            }))
          : [];
      }
    );
  });
};

export const getLeaderboardParticipantStatus = async (competitionId, userId) => {
  if (!userId) return "NOT_JOINED";
  try {
    const raw = await redis.hget(leaderboardMetaKey(competitionId), String(userId));
    if (raw) {
      const meta = JSON.parse(raw);
      return meta.status || "JOINED";
    }
  } catch {
    // fall through
  }
  return null;
};

/* =========================================================
   SOCKET AUTH MIDDLEWARE
========================================================= */
const authenticateSocket = (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) throw new Error("No token");

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
};

/* =========================================================
   AUTO-START COMPETITION
========================================================= */
const autoStartCompetition = async (io, competition) => {
  const now = new Date();
  if (competition.status !== "UPCOMING") return;
  if (now < competition.startTime) return;

  await CompetitionModel.findByIdAndUpdate(competition._id, {
    $set: { status: "LIVE", isActive: true },
  });
  competition.status = "LIVE";
  competition.isActive = true;

  // Emit immediately — don't wait for Redis
  io.to(`competition_${competition._id}`).emit("competitionStarted");
  scheduleCompetitionEnd(io, competition._id, competition.endTime);

  // Build Redis in background
  setImmediate(async () => {
    try {
      const exists = await redis.exists(leaderboardKey(competition._id));
      if (!exists) await buildRedisLeaderboard(competition._id);
    } catch (err) {
      console.error("[Leaderboard] Redis build error after start:", err);
    }
  });
};

/* =========================================================
   COMPETITION END HANDLER
========================================================= */
const handleCompetitionEnd = async (io, competitionId) => {
  const id = String(competitionId);
  if (endingCompetitions.has(id)) return;
  endingCompetitions.add(id);

  try {
    let acquired = true;
    try {
      const lock = await redis.set(`lock:comp-end:${id}`, "1", "PX", 120000, "NX");
      acquired = lock === "OK";
    } catch {
      acquired = true;
    }
    if (!acquired) return;
  const endTime = new Date();

  // Push results to clients immediately from Redis/cache so the
  // leaderboard screen does not wait on Mongo rebuilds.
  try {
    const quickBoard = await getCurrentLeaderboard(competitionId);
    io.to(`competition_${competitionId}`).emit("competitionEnded", {
      leaderboard: (quickBoard || []).map((p) => ({ ...p, status: "SUBMITTED" })),
      message: "Competition ended!",
    });
  } catch (emitErr) {
    console.error("[Leaderboard] early competitionEnded emit failed:", emitErr);
  }

  // Auto-submit anyone who did not click submit before the timer ended
  await ParticipantModel.updateMany(
    { competitionId, status: { $ne: "SUBMITTED" } },
    {
      $set: {
        status: "SUBMITTED",
        isSubmitted: true,
        isActive: false,
        submittedAt: endTime,
      },
    }
  );

  invalidateLeaderboardCache(competitionId);

  // Rebuild Redis so leaderboard/lobby reads show SUBMITTED immediately
  try {
    await buildRedisLeaderboard(competitionId);
  } catch (redisErr) {
    console.error("[Leaderboard] Redis rebuild after competition end:", redisErr);
  }

  const participants = await ParticipantModel.find({ competitionId })
    .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
    .populate("userId", "name avatar")
    .lean();

  const sorted = [...participants].sort((a, b) => {
    if (b.puzzlesSolved !== a.puzzlesSolved) return b.puzzlesSolved - a.puzzlesSolved;
    const aTime = sanitizeStoredSolveSeconds(a.timeSpent);
    const bTime = sanitizeStoredSolveSeconds(b.timeSpent);
    if (aTime !== bTime) return aTime - bTime;
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.joinedAt) - new Date(b.joinedAt);
  });

  const finalLeaderboard = sorted.map((p, index) => {
    const totalSolveTime = sanitizeStoredSolveSeconds(p.timeSpent);
    return {
      rank: index + 1,
      userId: p.userId?._id?.toString(),
      username: p.username,
      name: p.userId?.name,
      avatar: p.userId?.avatar,
      score: p.score || 0,
      puzzlesSolved: p.puzzlesSolved || 0,
      timeSpent: totalSolveTime,
      totalSolveTime,
      status: p.status,
      submittedAt: p.submittedAt,
      joinedAt: p.joinedAt,
    };
  });
  // Emit the final leaderboard to all participants.
  io.to(`competition_${competitionId}`).emit("competitionEnded", {
    leaderboard: finalLeaderboard,
    message: "Competition ended! Calculating final results...",
  });

  try {
    await CompetitionModel.findByIdAndUpdate(competitionId, {
      status: "ENDED",
      isActive: false,
      updatedAt: new Date(),
    });

    await CompetitionRankingModel.deleteMany({ competitionId });

    if (finalLeaderboard.length) {
      await CompetitionRankingModel.insertMany(
        finalLeaderboard.map(p => ({
          competitionId,
          userId: p.userId,
          username: p.username,
          finalRank: p.rank,
          finalScore: p.score,
          puzzlesSolved: p.puzzlesSolved,
          totalTime: p.totalSolveTime ?? p.timeSpent ?? 0,
          ENDEDAt: new Date(),
        }))
      );
    }

    setTimeout(async () => {
      try {
        const pipeline = redis.pipeline();
        pipeline.del(leaderboardKey(competitionId));
        pipeline.del(leaderboardMetaKey(competitionId));
        await pipeline.exec();
        console.log(`Redis leaderboard cleaned up for ${competitionId}`);
      } catch (err) {
        console.error("[Leaderboard] Redis cleanup error:", err);
      }
    }, 5 * 60 * 1000);

    console.log(`Competition ${competitionId} final results saved.`);
  } catch (err) {
    console.error(
      `[Leaderboard] Error saving final results for ${competitionId}:`,
      err
    );
  }
  } finally {
    endingCompetitions.delete(id);
  }
};

/* =========================================================
   ENSURE COMPETITION ENDED (idempotent — safe to call from lobby/REST)
========================================================= */
const ensureCompetitionEnded = async (competitionId) => {
  const io = getIO();
  if (!io) return false;
  if (endingCompetitions.has(String(competitionId))) return true;

  const comp = await CompetitionModel.findById(competitionId)
    .select("status endTime")
    .lean();
  if (!comp) return false;

  const now = Date.now();
  const endMs = new Date(comp.endTime).getTime();
  const timeExpired = Number.isFinite(endMs) && now > endMs;
  const markedEnded = (comp.status || "").toUpperCase() === "ENDED";

  if (!timeExpired && !markedEnded) return false;

  const pendingSubmit = await ParticipantModel.countDocuments({
    competitionId,
    status: { $ne: "SUBMITTED" },
  });

  if (markedEnded && pendingSubmit === 0) return true;

  await handleCompetitionEnd(io, competitionId);
  return true;
};

/* =========================================================
   SCHEDULE COMPETITION END
========================================================= */
const scheduleCompetitionEnd = (io, competitionId, endTime) => {
  const id = String(competitionId);
  const endMs = new Date(endTime).getTime();
  if (!Number.isFinite(endMs)) return;

  const existing = scheduledEndTimers.get(id);
  if (existing) clearTimeout(existing);

  const delay = endMs - Date.now();
  if (delay <= 0) {
    setImmediate(() => {
      handleCompetitionEnd(io, competitionId).catch((err) => {
        console.error(`[Competition] Immediate end failed for ${id}:`, err);
      });
    });
    return;
  }

  const timerId = setTimeout(() => {
    scheduledEndTimers.delete(id);
    handleCompetitionEnd(io, competitionId).catch((err) => {
      console.error(`[Competition] Scheduled end failed for ${id}:`, err);
    });
  }, delay);

  scheduledEndTimers.set(id, timerId);
};

const isChatRoomOpen = async (roomId) => {
  if (!roomId || typeof roomId !== "string") return false;
  const separator = roomId.indexOf("_");
  if (separator <= 0) return false;

  const kind = roomId.slice(0, separator);
  const id = roomId.slice(separator + 1);
  if (!mongoose.Types.ObjectId.isValid(id)) return false;

  let startTime = null;
  if (kind === "competition") {
    const competition = await CompetitionModel.findById(id).select("startTime").lean();
    startTime = competition?.startTime;
  } else if (kind === "event") {
    const event = await EventModel.findById(id).select("startTime").lean();
    startTime = event?.startTime;
  } else {
    return false;
  }

  return isChatOpenForEventDay(startTime);
};

/* =========================================================
   SOCKET INITIALIZER
========================================================= */
export const initializeSocketHandlers = (io) => {
  _io = io;
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    /* ── JOIN ── */
    socket.on("joinCompetition", async ({ competitionId }) => {
      try {
        socket.join(`competition_${competitionId}`);

        const leaderboard = await getCurrentLeaderboard(competitionId);

        socket.emit("competitionJoined", {
          serverTime: Date.now(),
          leaderboard,
        });

        // Send Chat History
        const roomId = `competition_${competitionId}`;
        const chatHistoryRaw = await redis.lrange(`chat:${roomId}`, -50, -1);
        const chatHistory = chatHistoryRaw.map(msg => JSON.parse(msg));
        socket.emit("chatHistory", { roomId, history: chatHistory });
      } catch (err) {
        console.error("[Socket] joinCompetition error:", err);
      }
    });

    /* ── JOIN EVENT ── */
    socket.on("joinEvent", async ({ eventId }) => {
      try {
        socket.join(`event_${eventId}`);

        socket.emit("eventJoined", {
          serverTime: Date.now(),
        });

        // Send Chat History
        const roomId = `event_${eventId}`;
        const chatHistoryRaw = await redis.lrange(`chat:${roomId}`, -50, -1);
        const chatHistory = chatHistoryRaw.map(msg => JSON.parse(msg));
        socket.emit("chatHistory", { roomId, history: chatHistory });
      } catch (err) {
        console.error("[Socket] joinEvent error:", err);
      }
    });

    /* ── SEND CHAT MESSAGE ── */
    /**
     * ARCHITECTURAL DECISION RECORD (ADR) - CHAT RATE LIMITING & COOLDOWN REMOVAL:
     * 
     * Context & Decision:
     * The temporary rapid-message cooldown (previously max 3 msgs / 5s with a 20s lock) was intentionally
     * removed per product requirements. Rapid-message locking disrupted user experience during high-engagement
     * live events and competitions where rapid communication is expected.
     * 
     * Expected Product Behavior:
     * Users experience fluid, uninterrupted chat messaging without experiencing "Chat disabled"
     * popups or temporary lockouts when communicating quickly.
     * 
     * Active Protections & Security Controls:
     * 1. Socket Authentication: Only authenticated users with valid socket tokens can emit chat messages.
     * 2. Payload Validation & Sanitization: Empty/whitespace messages are rejected (`!message.trim()`).
     * 3. Redis Bounded Buffers: Chat history is trimmed to a max of 100 messages (`redis.ltrim`) to prevent memory exhaustion.
     * 4. Event-day window: new messages are rejected after 12:00 AM IST on the day after the competition or event start. History remains readable.
     * 5. Language and spam: obscenity and a slang list reject profanity without starting the lock. Keyboard mash, symbol noise, shouting, repeated or lookalike lines, and a fourth message within 20 seconds lock that user for 20 seconds, then 1 minute, then 3 minutes. The rejected message is not stored. Short chess lines such as moves, gg, and mate stay allowed.
     */
    socket.on("sendChatMessage", async ({ roomId, message }) => {
      try {
        if (!message || message.trim() === "") return;
        const trimmed = message.trim();

        const chatOpen = await isChatRoomOpen(roomId);
        if (!chatOpen) {
          socket.emit("chatClosed", { roomId });
          return;
        }

        if (containsBadLanguage(trimmed) || containsSlang(trimmed)) {
          socket.emit("chatError", { message: "Kindly use good language!" });
          return;
        }

        const spam = checkChatSpam(String(socket.userId || socket.id), trimmed);
        if (spam.blocked) {
          socket.emit("chatError", {
            message: spam.message,
            cooldownSeconds: spam.seconds,
          });
          return;
        }

        // Fetch user details
        const user = await getAuthUserById(socket.userId);

        const messageObj = {
          id: String(Date.now()) + Math.random().toString(36).substr(2, 5),
          userId: socket.userId,
          username: user?.username || user?.name || "Anonymous",
          avatar: user?.avatar || null,
          message: trimmed,
          timestamp: new Date()
        };

        // Cache message in Redis list, cap at 100
        await redis.rpush(`chat:${roomId}`, JSON.stringify(messageObj));
        await redis.ltrim(`chat:${roomId}`, -100, -1);

        // Broadcast to room
        io.to(roomId).emit("chatMessage", { roomId, message: messageObj });
      } catch (err) {
        console.error("[Socket] sendChatMessage error:", err);
      }
    });

    /* ── SUBMIT ── */
    socket.on("submitCompetition", async ({ competitionId }) => {
      try {
        const competition = await CompetitionModel.findById(competitionId).select("puzzles").lean();
        if (!competition) {
          socket.emit("error", { message: "Competition not found" });
          return;
        }

        const unattemptedIds = await getUnattemptedPuzzleIds(
          competitionId,
          socket.userId,
          competition.puzzles || []
        );

        if (unattemptedIds.length > 0) {
          socket.emit("error", {
            message: `Please attempt all puzzles before submitting. ${unattemptedIds.length} puzzle${unattemptedIds.length > 1 ? "s" : ""} remaining.`,
            unattempted: unattemptedIds.length,
          });
          return;
        }

        const participant = await ParticipantModel.findOneAndUpdate(
          { competitionId, userId: socket.userId },
          {
            status: "SUBMITTED",
            submittedAt: new Date(),
            isSubmitted: true,
            isActive: false,
          },
          { new: true }
        ).populate("userId", "name avatar");

        if (!participant) return;

        // Upsert into Redis using the fixed helper (no duplicates)
        await upsertLeaderboardEntry(competitionId, {
          userId: participant.userId._id.toString(),
          username: participant.username,
          name: participant.userId.name,
          avatar: participant.userId.avatar,
          score: participant.score,
          puzzlesSolved: participant.puzzlesSolved,
          timeSpent: participant.timeSpent,
          status: "SUBMITTED",
          submittedAt: participant.submittedAt,
        });

        emitLeaderboardUpdateDebounced(competitionId);
      } catch (err) {
        console.error("[Socket] submitCompetition error:", err);
      }
    });

    /* ── REFRESH LEADERBOARD ── */
    socket.on("refreshLeaderboard", async ({ competitionId }) => {
      try {
        if (!competitionId) return;
        const leaderboard = await getCurrentLeaderboard(competitionId);
        socket.emit("leaderboardUpdate", leaderboard);
      } catch (err) {
        console.error("[Socket] refreshLeaderboard error:", err);
      }
    });

    /* ── DISCONNECT ── */
    socket.on("disconnect", () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("Disconnected:", socket.userId);
      }
    });
  });

  /* =========================================================
     SERVER RESTART RECOVERY
  ========================================================= */
  const recover = async () => {
    try {
      const competitions = await CompetitionModel.find({
        endTime: { $gt: new Date() },
      })
        .select("status startTime endTime")
        .lean();

      for (const comp of competitions) {
        if (comp.status === "LIVE") {
          const exists = await redis.exists(leaderboardKey(comp._id));
          if (!exists) await buildRedisLeaderboard(comp._id);
          scheduleCompetitionEnd(io, comp._id, comp.endTime);
        }

        if (comp.status === "UPCOMING") {
          setImmediate(async () => {
            try {
              const exists = await redis.exists(leaderboardKey(comp._id));
              if (!exists) await buildRedisLeaderboard(comp._id);
            } catch (err) {
              console.error(
                `[Leaderboard] Redis pre-build error for upcoming ${comp._id}:`,
                err
              );
            }
          });
          await autoStartCompetition(io, comp);
        }
      }

      console.log(`♻️  Recovered ${competitions.length} competitions`);

      const expiredLive = await CompetitionModel.find({
        status: { $in: ["LIVE", "live"] },
        endTime: { $lte: new Date() },
      }).select("_id");
      for (const comp of expiredLive) {
        await ensureCompetitionEnded(comp._id);
      }
    } catch (err) {
      console.error("[Socket] Recovery error:", err);
    }
  };

  // Only run after DB is ready — avoids 'buffering timed out' on startup
  const startPolling = () => {
    if (!isPrimaryWorker()) {
      console.log("[Competition Socket] Skipping recovery/polling on non-primary worker");
      return;
    }
    recover();

    // Poll for UPCOMING competitions that should have started
    setInterval(async () => {
      try {
        const comps = await CompetitionModel.find({
          status: "UPCOMING",
          startTime: { $lte: new Date() },
          endTime: { $gt: new Date() },
        })
          .select("status startTime endTime")
          .lean();
        for (const c of comps) await autoStartCompetition(io, c);
      } catch (err) {
        console.error("[Socket] Auto-start poll error:", err);
      }
    }, 10_000);

    // Poll for LIVE competitions whose endTime has passed (missed setTimeout / server restart)
    setInterval(async () => {
      try {
        const comps = await CompetitionModel.find({
          status: { $in: ["LIVE", "live"] },
          endTime: { $lte: new Date() },
        }).select("_id endTime status");
        for (const c of comps) {
          await ensureCompetitionEnded(c._id);
        }
      } catch (err) {
        console.error("[Socket] Auto-end poll error:", err);
      }
    }, 10_000);
  };

  if (mongoose.connection.readyState === 1) {
    startPolling();
  } else {
    mongoose.connection.once("connected", () => {
      console.log("[Competition Socket] DB ready — starting recovery & polling");
      startPolling();
    });
  }
};

/* =========================================================
   ADD PARTICIPANT TO LEADERBOARD  (called from join route)
========================================================= */
export const addParticipantToLeaderboard = async (
  competitionId,
  participant
) => {
  if (!participant?.userId) return;

  try {
    const exists = await redis.exists(leaderboardKey(competitionId));
    if (!exists) {
      await buildRedisLeaderboard(competitionId);
    }
  } catch (err) {
    console.error(`[Leaderboard] hydrate-on-join failed for ${competitionId}:`, err);
  }

  await upsertLeaderboardEntry(competitionId, participant);
  emitLeaderboardUpdateDebounced(competitionId);
};

/* =========================================================
   UPDATE PARTICIPANT SCORE  (call this from your solve route
   instead of doing a raw redis.zadd elsewhere)
========================================================= */
export const updateParticipantScore = async (competitionId, userId) => {
  try {
    const participant = await ParticipantModel.findOne({
      competitionId,
      userId,
    })
      .select("userId username score puzzlesSolved timeSpent status submittedAt")
      .populate("userId", "name avatar")
      .lean();

    if (!participant) return;

    await upsertLeaderboardEntry(competitionId, {
      userId: participant.userId._id.toString(),
      username: participant.username,
      name: participant.userId.name,
      avatar: participant.userId.avatar,
      score: participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent: participant.timeSpent,
      status: participant.status,
      submittedAt: participant.submittedAt,
    });

    emitLeaderboardUpdateDebounced(competitionId);
  } catch (error) {
    console.error(
      `[Leaderboard] updateParticipantScore error for ${competitionId}:`,
      error
    );
  }
};

/* =========================================================
   EXPORTS
========================================================= */
export {
  getCurrentLeaderboard,
  handleCompetitionEnd,
  ensureCompetitionEnded,
  scheduleCompetitionEnd,
  getIO,
  leaderboardKey,
  leaderboardMetaKey,
  redisScore,
  upsertLeaderboardEntry,
  emitLeaderboardUpdateDebounced,
};