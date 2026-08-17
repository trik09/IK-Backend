import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import mongoose from "mongoose";
import EventModel from "../models/EventSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import EventRankingModel from "../models/EventRankingSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import { recordHit, recordMiss } from "./cacheMetrics.js";
import { getUnattemptedPuzzleIds, calcTotalSolveTime, sanitizeStoredSolveSeconds, MAX_PLAUSIBLE_SOLVE_SECONDS } from "./puzzleAttemptUtils.js";

const plausibleSolveTimeSum = {
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
};

/* =========================================================
   MODULE STATE
 ========================================================= */
let _io = null;
const getIO = () => _io;
const endingEvents = new Set();

const EVENT_LEADERBOARD_CACHE_TTL_MS = 1000;
const EVENT_LEADERBOARD_BROADCAST_DEBOUNCE_MS = 300;
const eventLeaderboardResponseCache = new Map();
const pendingEventLeaderboardBroadcasts = new Map();

const getCachedEventLeaderboard = (eventId) => {
  const cached = eventLeaderboardResponseCache.get(eventId);
  if (cached && Date.now() - cached.ts < EVENT_LEADERBOARD_CACHE_TTL_MS) {
    recordHit("eventLeaderboard");
    return cached.data;
  }
  recordMiss("eventLeaderboard");
  return null;
};

const setCachedEventLeaderboard = (eventId, data) => {
  eventLeaderboardResponseCache.set(eventId, { data, ts: Date.now() });
};

const invalidateEventLeaderboardCache = (eventId) => {
  eventLeaderboardResponseCache.delete(eventId);
};

const emitEventLeaderboardUpdateDebounced = (eventId) => {
  if (!_io) return;

  const existing = pendingEventLeaderboardBroadcasts.get(eventId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingEventLeaderboardBroadcasts.delete(eventId);
    try {
      const leaderboard = await getCurrentEventLeaderboard(eventId);
      _io.to(`event_${eventId}`).emit("eventLeaderboardUpdate", leaderboard);
    } catch (err) {
      console.error("[Event Leaderboard] debounced broadcast error:", err);
    }
  }, EVENT_LEADERBOARD_BROADCAST_DEBOUNCE_MS);

  pendingEventLeaderboardBroadcasts.set(eventId, timer);
};

/* =========================================================
   REDIS KEY HELPERS
 ========================================================= */
const eventLeaderboardKey = (eventId) => `leaderboard:event:${eventId}`;
const eventLeaderboardMetaKey = (eventId) => `leaderboard:event:meta:${eventId}`;

/* =========================================================
   SCORE FORMULA
 ========================================================= */
const redisScore = (p) =>
  p.puzzlesSolved * 1_000_000 -
  p.timeSpent * 1_000 +
  (p.score || 0);

/* =========================================================
   CORE REDIS UPSERT
 ========================================================= */
const upsertEventLeaderboardEntry = async (
  eventId,
  participant,
  { recalcSolveTime = false } = {}
) => {
  const userId =
    participant.userId?._id?.toString() ||
    participant.userId?.toString();

  if (!userId) return;

  // Only add to live leaderboard if approved!
  if (participant.isApproved === false) return;

  try {
    let totalSolveTime = sanitizeStoredSolveSeconds(
      participant.totalSolveTime ?? participant.timeSpent
    );
    if (recalcSolveTime || !totalSolveTime) {
      totalSolveTime = Math.max(
        totalSolveTime,
        await calcTotalSolveTime(eventId, userId)
      );
    }
    const pipeline = redis.pipeline();

    pipeline.zadd(
      eventLeaderboardKey(eventId),
      redisScore({ ...participant, timeSpent: totalSolveTime }),
      userId
    );

    pipeline.hset(
      eventLeaderboardMetaKey(eventId),
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
        totalSolveTime: totalSolveTime,
        status: participant.status || "JOINED",
        submittedAt: participant.submittedAt || null,
      })
    );

    await pipeline.exec();
    invalidateEventLeaderboardCache(eventId);
  } catch (error) {
    console.error(
      `[Event Leaderboard] upsertEventLeaderboardEntry error for ${eventId}:`,
      error
    );
  }
};

/* =========================================================
   BUILD LEADERBOARD IN REDIS
 ========================================================= */
const buildRedisEventLeaderboard = async (eventId) => {
  try {
    const participants = await EventParticipantModel.find({ eventId, isApproved: true })
      .select("userId username score puzzlesSolved timeSpent status submittedAt")
      .populate("userId", "name avatar")
      .lean();

    if (!participants.length) return;

    const totalTimeAgg = await PuzzleAttemptModel.aggregate([
      { $match: { competitionId: eventId } },
      { $group: { _id: "$userId", total: plausibleSolveTimeSum } },
    ]);
    const totalTimeMap = new Map();
    totalTimeAgg.forEach((doc) => {
      if (doc._id) totalTimeMap.set(doc._id.toString(), sanitizeStoredSolveSeconds(doc.total));
    });

    const pipeline = redis.pipeline();
    const key = eventLeaderboardKey(eventId);
    const metaKey = eventLeaderboardMetaKey(eventId);

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
          totalSolveTime,
          status: p.status || "JOINED",
          submittedAt: p.submittedAt || null,
        })
      );
    }

    await pipeline.exec();
    console.log(`🔥 Redis event leaderboard built for ${eventId}`);
  } catch (error) {
    console.error(
      `[Event Leaderboard] Redis build error for ${eventId}:`,
      error
    );
  }
};

/* =========================================================
   GET LEADERBOARD  (Redis-first, short-lived cache)
 ========================================================= */
const getCurrentEventLeaderboard = async (eventId, limit = 200, skip = 0) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const safeSkip = Math.max(0, Number(skip) || 0);
  const cached = getCachedEventLeaderboard(eventId);
  if (cached) {
    return cached.slice(safeSkip, safeSkip + safeLimit).map((entry, index) => ({
      ...entry,
      rank: safeSkip + index + 1,
    }));
  }

  const key = eventLeaderboardKey(eventId);
  const metaKey = eventLeaderboardMetaKey(eventId);

  try {
    const userIds = await redis.zrevrange(
      key,
      safeSkip,
      safeSkip + safeLimit - 1
    );

    if (userIds?.length) {
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
            rank: safeSkip + index + 1,
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
          };
        })
        .filter(Boolean);

      if (leaderboard.length) {
        if (safeSkip === 0) {
          setCachedEventLeaderboard(eventId, leaderboard);
        }
        return leaderboard;
      }
    }
  } catch (error) {
    console.error(`[Event Leaderboard] Redis read error for ${eventId}:`, error);
  }

  console.warn(`[Event Leaderboard] Falling back to DB for ${eventId}`);

  const participants = await EventParticipantModel.find({ eventId, isApproved: true })
    .select("userId username score puzzlesSolved timeSpent status submittedAt")
    .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1 })
    .skip(safeSkip)
    .limit(safeLimit)
    .populate("userId", "name avatar")
    .lean();

  if (!participants.length) return [];

  const leaderboard = participants.map((p, index) => {
    const uid = p.userId?._id?.toString() || p.userId?.toString();
    const totalSolveTime = sanitizeStoredSolveSeconds(p.timeSpent);
    return {
      rank: safeSkip + index + 1,
      userId: uid,
      username: p.username,
      name: p.userId?.name,
      avatar: p.userId?.avatar,
      score: p.score || 0,
      puzzlesSolved: p.puzzlesSolved || 0,
      timeSpent: totalSolveTime,
      totalSolveTime,
      status: p.status,
      submittedAt: p.submittedAt,
    };
  });

  if (safeSkip === 0) {
    setCachedEventLeaderboard(eventId, leaderboard);
  }

  setImmediate(async () => {
    try {
      const exists = await redis.exists(key);
      if (exists) return;
      await buildRedisEventLeaderboard(eventId);
    } catch (err) {
      console.error("[Event Leaderboard] Redis rebuild error:", err);
    }
  });

  return leaderboard;
};

/* =========================================================
   AUTO-START EVENT
 ========================================================= */
const autoStartEvent = async (io, event) => {
  const now = new Date();
  if (event.status !== "UPCOMING") return;
  if (now < event.startTime) return;

  event.status = "LIVE";
  event.isActive = true;
  await event.save();

  io.to(`event_${event._id}`).emit("eventStarted");
  scheduleEventEnd(io, event._id, event.endTime);

  setImmediate(async () => {
    try {
      const exists = await redis.exists(eventLeaderboardKey(event._id));
      if (!exists) await buildRedisEventLeaderboard(event._id);
    } catch (err) {
      console.error("[Event Leaderboard] Redis build error after start:", err);
    }
  });
};

/* =========================================================
   EVENT END HANDLER
 ========================================================= */
const handleEventEnd = async (io, eventId) => {
  const id = String(eventId);
  if (endingEvents.has(id)) return;
  endingEvents.add(id);

  try {
  const endTime = new Date();

  await EventParticipantModel.updateMany(
    { eventId, isApproved: true, status: { $ne: "SUBMITTED" } },
    {
      $set: {
        status: "SUBMITTED",
        isSubmitted: true,
        isActive: false,
        submittedAt: endTime,
      },
    }
  );

  invalidateEventLeaderboardCache(eventId);

  io.to(`event_${eventId}`).emit("eventEnded", {
    message: "Event ended! Calculating final results...",
  });

  try {
      await EventModel.findByIdAndUpdate(eventId, {
        status: "ENDED",
        isActive: false,
        updatedAt: new Date(),
      });

      const allParticipants = await EventParticipantModel.find({ eventId, isApproved: true })
        .select("userId username fullName age score puzzlesSolved timeSpent")
        .populate("userId", "name avatar")
        .lean();

      const sorted = [...allParticipants].sort((a, b) => {
        if (b.puzzlesSolved !== a.puzzlesSolved) return b.puzzlesSolved - a.puzzlesSolved;
        const aTime = sanitizeStoredSolveSeconds(a.timeSpent);
        const bTime = sanitizeStoredSolveSeconds(b.timeSpent);
        if (aTime !== bTime) return aTime - bTime;
        return (b.score || 0) - (a.score || 0);
      });

      await EventRankingModel.deleteMany({ eventId });

      if (sorted.length) {
        await EventRankingModel.insertMany(
          sorted.map((p, idx) => ({
            eventId,
            userId: p.userId?._id || p.userId,
            username: p.username,
            fullName: p.fullName || p.userId?.name || p.username,
            age: p.age || null,
            roundScores: [],
            finalRank: idx + 1,
            finalScore: p.score || 0,
            totalPuzzlesSolved: p.puzzlesSolved || 0,
            totalTimeSpent: sanitizeStoredSolveSeconds(p.timeSpent),
            computedAt: new Date(),
          }))
        );
      }

      setTimeout(async () => {
        try {
          const pipeline = redis.pipeline();
          pipeline.del(eventLeaderboardKey(eventId));
          pipeline.del(eventLeaderboardMetaKey(eventId));
          await pipeline.exec();
          console.log(`Redis event leaderboard cleaned up for ${eventId}`);
        } catch (err) {
          console.error("[Event Leaderboard] Redis cleanup error:", err);
        }
      }, 5 * 60 * 1000);

      console.log(`Event ${eventId} final results saved (${sorted.length} participants).`);
    } catch (err) {
      console.error(
        `[Event Leaderboard] Error saving final results for ${eventId}:`,
        err
      );
    }
  } finally {
    endingEvents.delete(id);
  }
};

/* =========================================================
   SCHEDULE EVENT END
 ========================================================= */
const scheduleEventEnd = (io, eventId, endTime) => {
  const delay = endTime.getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    handleEventEnd(io, eventId);
  }, delay);
};

/* =========================================================
   SOCKET INITIALIZER (Reused in main socket setup)
 ========================================================= */
export const initializeEventSocketHandlers = (io) => {
  _io = io;

  io.on("connection", (socket) => {
    /* ── JOIN EVENT LOBBY ── */
    socket.on("joinEvent", async ({ eventId }) => {
      try {
        socket.join(`event_${eventId}`);

        const leaderboard = await getCurrentEventLeaderboard(eventId);

        socket.emit("eventJoined", {
          serverTime: Date.now(),
          leaderboard,
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

    /* ── SUBMIT EVENT ── */
    socket.on("submitEvent", async ({ eventId }) => {
      try {
        const event = await EventModel.findById(eventId).select("puzzles").lean();
        if (!event) {
          socket.emit("error", { message: "Event not found" });
          return;
        }

        const unattemptedIds = await getUnattemptedPuzzleIds(
          eventId,
          socket.userId,
          event.puzzles || []
        );

        if (unattemptedIds.length > 0) {
          socket.emit("error", {
            message: `Please attempt all puzzles before submitting. ${unattemptedIds.length} puzzle${unattemptedIds.length > 1 ? "s" : ""} remaining.`,
            unattempted: unattemptedIds.length,
          });
          return;
        }

        const participant = await EventParticipantModel.findOneAndUpdate(
          { eventId, userId: socket.userId, isApproved: true },
          {
            status: "SUBMITTED",
            submittedAt: new Date(),
            isSubmitted: true,
            isActive: false,
          },
          { new: true }
        ).populate("userId", "name avatar");

        if (!participant) return;

        await upsertEventLeaderboardEntry(eventId, {
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

        const leaderboard = await getCurrentEventLeaderboard(eventId);
        io.to(`event_${eventId}`).emit("eventLeaderboardUpdate", leaderboard);
      } catch (err) {
        console.error("[Socket] submitEvent error:", err);
      }
    });

    /* ── REFRESH LEADERBOARD ── */
    socket.on("refreshEventLeaderboard", async ({ eventId }) => {
      try {
        if (!eventId) return;
        const leaderboard = await getCurrentEventLeaderboard(eventId);
        socket.emit("eventLeaderboardUpdate", leaderboard);
      } catch (err) {
        console.error("[Socket] refreshEventLeaderboard error:", err);
      }
    });
  });

  const recover = async () => {
    try {
      const events = await EventModel.find({
        endTime: { $gt: new Date() },
      });

      for (const evt of events) {
        if (evt.status === "LIVE") {
          const exists = await redis.exists(eventLeaderboardKey(evt._id));
          if (!exists) await buildRedisEventLeaderboard(evt._id);
          scheduleEventEnd(io, evt._id, evt.endTime);
        }

        if (evt.status === "UPCOMING") {
          setImmediate(async () => {
            try {
              const exists = await redis.exists(eventLeaderboardKey(evt._id));
              if (!exists) await buildRedisEventLeaderboard(evt._id);
            } catch (err) {
              console.error(`[Event Leaderboard] Redis pre-build error for upcoming ${evt._id}:`, err);
            }
          });
          await autoStartEvent(io, evt);
        }
      }
      console.log(`♻️  Recovered ${events.length} events`);
    } catch (err) {
      console.error("[Socket] Event Recovery error:", err);
    }
  };

  // Only run after DB is ready — avoids buffering timeout on startup
  const startPolling = () => {
    recover();

    setInterval(async () => {
      try {
        const evts = await EventModel.find({
          status: "UPCOMING",
          startTime: { $lte: new Date() },
          endTime: { $gt: new Date() },
        });
        for (const e of evts) await autoStartEvent(io, e);
      } catch (err) {
        console.error("[Socket] Event Auto-start poll error:", err);
      }
    }, 10_000);
  };

  if (mongoose.connection.readyState === 1) {
    // DB already connected (unlikely on first boot, but safe)
    startPolling();
  } else {
    mongoose.connection.once("connected", () => {
      console.log("[Event Socket] DB ready — starting event recovery & polling");
      startPolling();
    });
  }
};

export const addEventParticipantToLeaderboard = async (eventId, participant) => {
  if (!participant?.userId) return;

  await upsertEventLeaderboardEntry(eventId, participant);
  emitEventLeaderboardUpdateDebounced(eventId);
};

export const updateEventParticipantScore = async (eventId, userId) => {
  try {
    const participant = await EventParticipantModel.findOne({
      eventId,
      userId,
      isApproved: true
    })
      .select("userId username score puzzlesSolved timeSpent status submittedAt")
      .populate("userId", "name avatar")
      .lean();

    if (!participant) return;

    await upsertEventLeaderboardEntry(eventId, {
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

    emitEventLeaderboardUpdateDebounced(eventId);
  } catch (error) {
    console.error(`[Event Leaderboard] updateEventParticipantScore error for ${eventId}:`, error);
  }
};

export {
  getCurrentEventLeaderboard,
  handleEventEnd,
  scheduleEventEnd,
  getIO,
  eventLeaderboardKey,
  eventLeaderboardMetaKey,
  redisScore,
  upsertEventLeaderboardEntry,
  emitEventLeaderboardUpdateDebounced,
};
