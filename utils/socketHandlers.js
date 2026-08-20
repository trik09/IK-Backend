// ==================== Redis Implementation (Refactored) ====================

import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import mongoose from "mongoose";
import CompetitionModel from "../models/CompetitionSchema.js";
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
const leaderboardResponseCache = new Map();
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

const getCurrentLeaderboard = async (competitionId, limit = 200, skip = 0) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const safeSkip = Math.max(0, Number(skip) || 0);
  const cached = getCachedLeaderboard(competitionId);
  if (cached) {
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
      .zrevrange(key, 0, rangeEnd)
      .exec();
    const exists = Number(pipeResults?.[0]?.[1] || 0);
    const userIds = pipeResults?.[1]?.[1] || [];

    if (exists) {
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
    socket.on("sendChatMessage", async ({ roomId, message }) => {
      try {
        if (!message || message.trim() === "") return;

        // Rate limiting: max 3 messages per 5 seconds, followed by a 20-second cooldown
        const now = Date.now();
        socket.chatTimestamps = (socket.chatTimestamps || []).filter(t => now - t < 5000);

        if (socket.chatCooldownUntil && now < socket.chatCooldownUntil) {
          const timeLeft = Math.ceil((socket.chatCooldownUntil - now) / 1000);
          socket.emit("chatError", { message: `Spam protection: Please wait ${timeLeft} seconds.` });
          return;
        }

        socket.chatTimestamps.push(now);

        if (socket.chatTimestamps.length >= 3) {
          socket.chatCooldownUntil = now + 20000;
        }

        // Fetch user details
        const user = await getAuthUserById(socket.userId);

        const messageObj = {
          id: String(Date.now()) + Math.random().toString(36).substr(2, 5),
          userId: socket.userId,
          username: user?.username || user?.name || "Anonymous",
          avatar: user?.avatar || null,
          message: message.trim(),
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