import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import EventModel from "../models/EventSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import EventRankingModel from "../models/EventRankingSchema.js";

/* =========================================================
   MODULE STATE
 ========================================================= */
let _io = null;
const getIO = () => _io;

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
const upsertEventLeaderboardEntry = async (eventId, participant) => {
  const userId =
    participant.userId?._id?.toString() ||
    participant.userId?.toString();

  if (!userId) return;

  // Only add to live leaderboard if approved!
  if (participant.isApproved === false) return;

  try {
    const pipeline = redis.pipeline();

    pipeline.zadd(
      eventLeaderboardKey(eventId),
      redisScore(participant),
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
        timeSpent: participant.timeSpent || 0,
        status: participant.status || "JOINED",
        submittedAt: participant.submittedAt || null,
      })
    );

    await pipeline.exec();
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

    const pipeline = redis.pipeline();
    const key = eventLeaderboardKey(eventId);
    const metaKey = eventLeaderboardMetaKey(eventId);

    for (const p of participants) {
      if (!p.userId) continue;
      const userId = p.userId._id.toString();

      pipeline.zadd(key, redisScore(p), userId);

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
          timeSpent: p.timeSpent || 0,
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
   GET LEADERBOARD
 ========================================================= */
const getCurrentEventLeaderboard = async (eventId, limit = 200) => {
  const key = eventLeaderboardKey(eventId);
  const metaKey = eventLeaderboardMetaKey(eventId);

  try {
    const userIds = await redis.zrevrange(key, 0, limit - 1);

    if (userIds?.length) {
      const pipeline = redis.pipeline();
      userIds.forEach((uid) => pipeline.hget(metaKey, uid));
      const metaResults = await pipeline.exec();

      const dbParticipants = await EventParticipantModel.find({
        eventId,
        userId: { $in: userIds },
        isApproved: true
      })
        .select("userId username score puzzlesSolved timeSpent status submittedAt")
        .populate("userId", "name avatar")
        .lean();

      const dbMap = new Map();
      dbParticipants.forEach((p) => {
        if (p.userId) dbMap.set(p.userId._id.toString(), p);
      });

      return userIds
        .map((uid, index) => {
          const metaRaw = metaResults[index]?.[1];
          const meta = metaRaw ? JSON.parse(metaRaw) : null;
          const db = dbMap.get(uid);

          return {
            rank: index + 1,
            userId: uid,
            username: db?.username ?? meta?.username ?? null,
            name: db?.userId?.name ?? meta?.name ?? null,
            avatar: db?.userId?.avatar ?? meta?.avatar ?? null,
            score: db?.score ?? meta?.score ?? 0,
            puzzlesSolved: db?.puzzlesSolved ?? meta?.puzzlesSolved ?? 0,
            timeSpent: db?.timeSpent ?? meta?.timeSpent ?? 0,
            status: db?.status ?? meta?.status ?? "JOINED",
            submittedAt: db?.submittedAt ?? meta?.submittedAt ?? null,
          };
        })
        .filter(Boolean);
    }
  } catch (error) {
    console.error(`[Event Leaderboard] Redis read error for ${eventId}:`, error);
  }

  console.warn(`[Event Leaderboard] Falling back to DB for ${eventId}`);

  const participants = await EventParticipantModel.find({ eventId, isApproved: true })
    .select("userId username score puzzlesSolved timeSpent status submittedAt")
    .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1 })
    .limit(limit)
    .populate("userId", "name avatar")
    .lean();

  if (!participants.length) return [];

  const leaderboard = participants.map((p, index) => ({
    rank: index + 1,
    userId: p.userId?._id?.toString(),
    username: p.username,
    name: p.userId?.name,
    avatar: p.userId?.avatar,
    score: p.score || 0,
    puzzlesSolved: p.puzzlesSolved || 0,
    timeSpent: p.timeSpent || 0,
    status: p.status,
    submittedAt: p.submittedAt,
  }));

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
  const leaderboard = await getCurrentEventLeaderboard(eventId);
  io.to(`event_${eventId}`).emit("eventEnded", {
    leaderboard,
    message: "Event ended! Calculating final results...",
  });

  (async () => {
    try {
      await EventModel.findByIdAndUpdate(eventId, {
        status: "ENDED",
        isActive: false,
        updatedAt: new Date(),
      });

      const allParticipants = await EventParticipantModel.find({ eventId, isApproved: true })
        .select("userId username score puzzlesSolved timeSpent status submittedAt")
        .sort({ puzzlesSolved: -1, timeSpent: 1, score: -1 })
        .populate("userId", "name avatar")
        .lean();

      const finalLeaderboard = allParticipants.map((p, index) => ({
        rank: index + 1,
        userId: p.userId?._id?.toString(),
        username: p.username,
        score: p.score || 0,
        puzzlesSolved: p.puzzlesSolved || 0,
        timeSpent: p.timeSpent || 0,
        status: p.status,
        submittedAt: p.submittedAt,
      }));

      await EventRankingModel.deleteMany({ eventId });

      if (finalLeaderboard.length) {
        await EventRankingModel.insertMany(
          finalLeaderboard.map((p) => ({
            eventId,
            userId: p.userId,
            username: p.username,
            finalRank: p.rank,
            finalScore: p.score,
            puzzlesSolved: p.puzzlesSolved,
            totalTime: p.timeSpent,
            ENDEDAt: new Date(),
          }))
        );
      }

      setTimeout(async () => {
        try {
          const pipeline = redis.pipeline();
          pipeline.del(eventLeaderboardKey(eventId));
          pipeline.del(eventLeaderboardMetaKey(eventId));
          await pipeline.exec();
          console.log(`🧹 Redis event leaderboard cleaned up for ${eventId}`);
        } catch (err) {
          console.error("[Event Leaderboard] Redis cleanup error:", err);
        }
      }, 5 * 60 * 1000);

      console.log(`✅ Event ${eventId} final results saved.`);
    } catch (err) {
      console.error(
        `[Event Leaderboard] Error saving final results for ${eventId}:`,
        err
      );
    }
  })();
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
      } catch (err) {
        console.error("[Socket] joinEvent error:", err);
      }
    });

    /* ── SUBMIT EVENT ── */
    socket.on("submitEvent", async ({ eventId }) => {
      try {
        const participant = await EventParticipantModel.findOneAndUpdate(
          { eventId, userId: socket.userId, isApproved: true },
          { status: "SUBMITTED", submittedAt: new Date() },
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

export const addEventParticipantToLeaderboard = async (eventId, participant) => {
  if (!participant?.userId) return;

  await upsertEventLeaderboardEntry(eventId, participant);

  if (_io) {
    try {
      const leaderboard = await getCurrentEventLeaderboard(eventId);
      _io.to(`event_${eventId}`).emit("eventLeaderboardUpdate", leaderboard);
    } catch (err) {
      console.error("[Event Leaderboard] addEventParticipantToLeaderboard broadcast error:", err);
    }
  }
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

    if (_io) {
      const leaderboard = await getCurrentEventLeaderboard(eventId);
      _io.to(`event_${eventId}`).emit("eventLeaderboardUpdate", leaderboard);
    }
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
};
