// ==================== Redis Implementation (Refactored) ====================

import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import mongoose from "mongoose";
import CompetitionModel from "../models/CompetitionSchema.js";
import ParticipantModel from "../models/ParticipantSchema.js";
import CompetitionRankingModel from "../models/CompetitionRankingSchema.js";
import UserModel from "../models/UserSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import { calcTotalSolveTime, sanitizeStoredSolveSeconds, MAX_PLAUSIBLE_SOLVE_SECONDS } from "./puzzleAttemptUtils.js";

/* =========================================================
   MODULE STATE
========================================================= */
let _io = null;
const getIO = () => _io;

// Short in-memory cache so burst REST polls share one Redis read
const LEADERBOARD_CACHE_TTL_MS = 300;
const leaderboardResponseCache = new Map(); // competitionId -> { expiresAt, data }
const pendingLeaderboardBroadcasts = new Map(); // competitionId -> timeout
const LEADERBOARD_BROADCAST_DEBOUNCE_MS = 300;

const invalidateLeaderboardCache = (competitionId) => {
  leaderboardResponseCache.delete(String(competitionId));
};

const getCachedLeaderboard = (competitionId) => {
  const cached = leaderboardResponseCache.get(String(competitionId));
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    leaderboardResponseCache.delete(String(competitionId));
    return null;
  }
  return cached.data;
};

const setCachedLeaderboard = (competitionId, data) => {
  leaderboardResponseCache.set(String(competitionId), {
    expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
    data,
  });
};

/* =========================================================
   REDIS KEY HELPERS
========================================================= */
const leaderboardKey = (competitionId) => `leaderboard:${competitionId}`;
const leaderboardMetaKey = (competitionId) => `leaderboard:meta:${competitionId}`;

/* =========================================================
   SCORE FORMULA
   Higher puzzlesSolved → higher rank
   Lower timeSpent     → higher rank (within same puzzlesSolved)
   score               → tiebreaker
========================================================= */
const redisScore = (p) =>
  p.puzzlesSolved * 1_000_000 -
  p.timeSpent * 1_000 +
  (p.score || 0);

const mapMetaToLeaderboardEntry = (uid, index, meta) => {
  const totalSolveTime = sanitizeStoredSolveSeconds(
    meta?.totalSolveTime ?? meta?.timeSpent
  );
  return {
    rank: index + 1,
    userId: uid,
    username: meta?.username ?? null,
    name: meta?.name ?? null,
    avatar: meta?.avatar ?? null,
    score: meta?.score ?? 0,
    puzzlesSolved: meta?.puzzlesSolved ?? 0,
    timeSpent: totalSolveTime,
    totalSolveTime,
    status: meta?.status ?? "JOINED",
    submittedAt: meta?.submittedAt ?? null,
    joinedAt: meta?.joinedAt ?? null,
  };
};

/**
 * Debounced room broadcast — coalesces rapid solve/join bursts into one emit.
 * Keeps socket payload fresh without rebuilding/emitting on every write.
 */
const emitLeaderboardUpdateDebounced = (competitionId, delayMs = LEADERBOARD_BROADCAST_DEBOUNCE_MS) => {
  const id = String(competitionId);
  if (pendingLeaderboardBroadcasts.has(id)) return;

  const timer = setTimeout(async () => {
    pendingLeaderboardBroadcasts.delete(id);  
    if (!_io) return;
    try {
      invalidateLeaderboardCache(id);
      const leaderboard = await getCurrentLeaderboard(id);
      _io.to(`competition_${id}`).emit("leaderboardUpdate", leaderboard);
    } catch (err) {
      console.error(`[Leaderboard] debounced broadcast error for ${id}:`, err);
    }
  }, delayMs);

  pendingLeaderboardBroadcasts.set(id, timer);
};

/* =========================================================
   CORE REDIS UPSERT
   Member = plain userId string  →  ZADD is always an UPDATE,
   never an INSERT of a duplicate.  Metadata lives in a Hash.
========================================================= */
const upsertLeaderboardEntry = async (competitionId, participant) => {
  try {
    const userId =
      participant.userId?._id?.toString() ||
      participant.userId?.toString();
    if (!userId) return;

    // Hot path: trust caller-provided aggregate timeSpent (participant doc is
    // updated via $inc on submit). Optional recalcSolveTime for rebuilds only.
    let totalSolveTime = sanitizeStoredSolveSeconds(
      participant.totalSolveTime ?? participant.timeSpent
    );
    if (participant.recalcSolveTime) {
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
   GET LEADERBOARD  (Redis-first; Mongo only on cold miss)
 ========================================================= */
const getCurrentLeaderboard = async (competitionId, limit = 200) => {
  const id = String(competitionId);
  const cached = getCachedLeaderboard(id);
  if (cached) return cached.slice(0, limit);

  const key = leaderboardKey(id);
  const metaKey = leaderboardMetaKey(id);

  try {
    // 1. Ordered user ids from Redis ZSet
    const userIds = await redis.zrevrange(key, 0, limit - 1);

    if (userIds?.length) {
      // 2. Batch-fetch metadata from Redis hash only (no Mongo on hot path)
      const pipeline = redis.pipeline();
      userIds.forEach((uid) => pipeline.hget(metaKey, uid));
      const metaResults = await pipeline.exec();

      const leaderboard = [];
      const missingMetaIds = [];

      userIds.forEach((uid, index) => {
        const metaRaw = metaResults[index]?.[1];
        if (!metaRaw) {
          missingMetaIds.push(uid);
          return;
        }
        try {
          const meta = JSON.parse(metaRaw);
          leaderboard.push(mapMetaToLeaderboardEntry(uid, leaderboard.length, meta));
        } catch {
          missingMetaIds.push(uid);
        }
      });

      // Fill rare meta gaps from DB for those users only (not full competition scan)
      if (missingMetaIds.length) {
        const dbParticipants = await ParticipantModel.find({
          competitionId: id,
          userId: { $in: missingMetaIds },
        })
          .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
          .populate("userId", "name avatar")
          .lean();

        const dbMap = new Map();
        dbParticipants.forEach((p) => {
          const uid = p.userId?._id?.toString();
          if (uid) dbMap.set(uid, p);
        });

        // Rebuild ranks including filled gaps in Redis ZSet order
        const filled = [];
        for (let i = 0; i < userIds.length; i++) {
          const uid = userIds[i];
          const metaRaw = metaResults[i]?.[1];
          let meta = null;
          if (metaRaw) {
            try {
              meta = JSON.parse(metaRaw);
            } catch {
              meta = null;
            }
          }
          const db = dbMap.get(uid);
          if (!meta && !db) continue;

          const totalSolveTime = sanitizeStoredSolveSeconds(
            meta?.totalSolveTime ?? meta?.timeSpent ?? db?.timeSpent
          );
          filled.push({
            rank: filled.length + 1,
            userId: uid,
            username: meta?.username ?? db?.username ?? null,
            name: meta?.name ?? db?.userId?.name ?? null,
            avatar: meta?.avatar ?? db?.userId?.avatar ?? null,
            score: meta?.score ?? db?.score ?? 0,
            puzzlesSolved: meta?.puzzlesSolved ?? db?.puzzlesSolved ?? 0,
            timeSpent: totalSolveTime,
            totalSolveTime,
            status: meta?.status ?? db?.status ?? "JOINED",
            submittedAt: meta?.submittedAt ?? db?.submittedAt ?? null,
            joinedAt: meta?.joinedAt ?? db?.joinedAt ?? null,
          });

          // Backfill missing Redis meta asynchronously
          if (!meta && db) {
            setImmediate(() => {
              upsertLeaderboardEntry(id, {
                userId: uid,
                username: db.username,
                name: db.userId?.name,
                avatar: db.userId?.avatar,
                score: db.score,
                puzzlesSolved: db.puzzlesSolved,
                timeSpent: db.timeSpent,
                status: db.status,
                submittedAt: db.submittedAt,
                joinedAt: db.joinedAt,
              }).catch(() => {});
            });
          }
        }

        setCachedLeaderboard(id, filled);
        return filled;
      }

      // Fix ranks after filter
      leaderboard.forEach((entry, idx) => {
        entry.rank = idx + 1;
      });
      setCachedLeaderboard(id, leaderboard);
      return leaderboard;
    }
  } catch (error) {
    console.error(`[Leaderboard] Redis read error for ${id}:`, error);
  }

  // ── DB fallback (Redis miss / error) ──────────────────────────────────────
  console.warn(`[Leaderboard] Falling back to DB for ${id}`);

  const participants = await ParticipantModel.find({ competitionId: id })
    .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
    .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1, joinedAt: 1 })
    .limit(limit)
    .populate("userId", "name avatar")
    .lean();

  if (!participants.length) {
    setCachedLeaderboard(id, []);
    return [];
  }

  // Use stored participant.timeSpent — avoid N+1 calcTotalSolveTime under load
  const leaderboard = participants.map((p, index) => {
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
      submittedAt: p.submittedAt || null,
      joinedAt: p.joinedAt,
    };
  });

  setCachedLeaderboard(id, leaderboard);

  // Rebuild Redis in the background so next call is fast
  setImmediate(async () => {
    try {
      const exists = await redis.exists(key);
      if (exists) return;
      await buildRedisLeaderboard(id);
    } catch (err) {
      console.error("[Leaderboard] Redis rebuild error:", err);
    }
  });

  return leaderboard;
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

  competition.status = "LIVE";
  competition.isActive = true;
  await competition.save();

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
  const participants = await ParticipantModel.find({ competitionId })
    .select("userId username score puzzlesSolved timeSpent status submittedAt joinedAt")
    .populate("userId", "name avatar")
    .lean();

  const participantsWithSolveTime = await Promise.all(
    participants.map(async (p) => {
      const uid = p.userId?._id?.toString() || p.userId?.toString();
      const totalSolveTime = await calcTotalSolveTime(competitionId, uid);
      return { ...p, totalSolveTime };
    })
  );

  const sorted = [...participantsWithSolveTime].sort((a, b) => {
    if (b.puzzlesSolved !== a.puzzlesSolved) return b.puzzlesSolved - a.puzzlesSolved;
    const aTime = a.totalSolveTime ?? a.timeSpent ?? 0;
    const bTime = b.totalSolveTime ?? b.timeSpent ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.joinedAt) - new Date(b.joinedAt);
  });

  const finalLeaderboard = sorted.map((p, index) => ({
    rank: index + 1,
    userId: p.userId?._id?.toString(),
    username: p.username,
    name: p.userId?.name,
    avatar: p.userId?.avatar,
    score: p.score || 0,
    puzzlesSolved: p.puzzlesSolved || 0,
    timeSpent: p.totalSolveTime ?? p.timeSpent ?? 0,
    totalSolveTime: p.totalSolveTime ?? p.timeSpent ?? 0,
    status: p.status,
    submittedAt: p.submittedAt,
    joinedAt: p.joinedAt,
  }));
  // Emit the final leaderboard to all participants.
  io.to(`competition_${competitionId}`).emit("competitionEnded", {
    leaderboard: finalLeaderboard,
    message: "Competition ended! Calculating final results...",
  });

  // All heavy work happens in background AFTER the emit
  (async () => {
    try {
      await CompetitionModel.findByIdAndUpdate(competitionId, {
        status: "ENDED",
        isActive: false,
        updatedAt: new Date(),
      });

      // Always use DB for final rankings — Redis may miss 0-score users
      const allParticipants = await ParticipantModel.find({ competitionId })
        .select("userId username score puzzlesSolved timeSpent status submittedAt")
        .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1 })
        .populate("userId", "name avatar")
        .lean();

      // Build final leaderboard with required fields


      // Remove previous rankings for this competition
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

      // Clean up BOTH Redis keys — delay 5 minutes so the leaderboard
      // page can still read from Redis immediately after competition ends.
      setTimeout(async () => {
        try {
          const pipeline = redis.pipeline();
          pipeline.del(leaderboardKey(competitionId));
          pipeline.del(leaderboardMetaKey(competitionId));
          await pipeline.exec();
          console.log(`🧹 Redis leaderboard cleaned up for ${competitionId}`);
        } catch (err) {
          console.error("[Leaderboard] Redis cleanup error:", err);
        }
      }, 5 * 60 * 1000);

      console.log(
        `✅ Competition ${competitionId} final results saved.`
      );
    } catch (err) {
      console.error(
        `[Leaderboard] Error saving final results for ${competitionId}:`,
        err
      );
    }
  })();
};

/* =========================================================
   SCHEDULE COMPETITION END
========================================================= */
const scheduleCompetitionEnd = (io, competitionId, endTime) => {
  const delay = endTime.getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    handleCompetitionEnd(io, competitionId);
  }, delay);
};

/* =========================================================
   SOCKET INITIALIZER
========================================================= */
export const initializeSocketHandlers = (io) => {
  _io = io;
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    console.log("Connected:", socket.userId);

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
        const chatHistoryRaw = await redis.lrange(`chat:${roomId}`, 0, -1);
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
        const chatHistoryRaw = await redis.lrange(`chat:${roomId}`, 0, -1);
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
        const user = await UserModel.findById(socket.userId).select("username name avatar").lean();

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

        const leaderboard = await getCurrentLeaderboard(competitionId);
        io.to(`competition_${competitionId}`).emit("leaderboardUpdate", leaderboard);
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
      console.log(" Disconnected:", socket.userId);
    });
  });

  /* =========================================================
     SERVER RESTART RECOVERY
  ========================================================= */
  const recover = async () => {
    try {
      const competitions = await CompetitionModel.find({
        endTime: { $gt: new Date() },
      });

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
    } catch (err) {
      console.error("[Socket] Recovery error:", err);
    }
  };

  // Only run after DB is ready — avoids 'buffering timed out' on startup
  const startPolling = () => {
    recover();

    // Poll for UPCOMING competitions that should have started
    setInterval(async () => {
      try {
        const comps = await CompetitionModel.find({
          status: "UPCOMING",
          startTime: { $lte: new Date() },
          endTime: { $gt: new Date() },
        });
        for (const c of comps) await autoStartCompetition(io, c);
      } catch (err) {
        console.error("[Socket] Auto-start poll error:", err);
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

  // Use the fixed upsert — safe against duplicates
  await upsertLeaderboardEntry(competitionId, participant);

  // Debounced broadcast — avoid full rebuild/emit storms on mass joins
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
  scheduleCompetitionEnd,
  getIO,
  leaderboardKey,
  leaderboardMetaKey,
  redisScore,
  upsertLeaderboardEntry,
  emitLeaderboardUpdateDebounced,
  invalidateLeaderboardCache,
};