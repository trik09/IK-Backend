/**
 * socketExamHandlers.js
 *
 * Socket.IO integration for the exam system.
 *
 * Design:
 *  - One socket room per exam:  "exam_<examId>"
 *  - Users join the room from the lobby (before the exam starts) and stay
 *    connected through the exam itself.
 *  - All real-time events are pushed by the server — the frontend does NOT
 *    need to poll anymore.
 *
 * Events emitted BY server → clients:
 *  examRoomJoined          – confirms room entry, sends current participant list
 *  examParticipantJoined   – broadcast when any user joins the exam
 *  examParticipantSubmitted– broadcast when any user submits
 *  examAllSubmitted        – broadcast when every registered participant submitted
 *  examEnded               – broadcast when endTime is reached (server-side timer)
 *  examTimingUpdated       – broadcast when admin changes start/end/duration
 *
 * Events emitted BY client → server:
 *  joinExamRoom            – join the socket room for a given examId
 *  leaveExamRoom           – leave the room (optional, auto on disconnect)
 */

import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import ExamModel from "../models/ExamSchema.js";
import ExamParticipantModel from "../models/ExamParticipantSchema.js";
import {
  scoreExam,
} from "./examScoringEngine.js";
import {
  resolveTimeSpentForSubmit,
} from "./examTimeUtils.js";
import {
  getExamMeta,
  getExamQuizDocs,
  getExamRoster,
  invalidateExamCache,
  quizDocsToMap,
} from "./examCache.js";

/* ─── Module-level io reference ─────────────────────────────────────────────── */
let _io = null;
export const getExamIO = () => _io;

/* ─── Scheduled end timers  (examId → NodeJS.Timeout) ───────────────────────── */
const endTimers = new Map();

/* ─── Prevent concurrent end/force-submit for the same exam ─────────────────── */
const endingInProgress = new Set();

/* ─── Socket auth middleware (same pattern as competition handler) ────────────── */
const authenticateSocket = (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error("No token");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
};

/* ─── Room name helper ───────────────────────────────────────────────────────── */
export const examRoomName = (examId) => `exam_${examId}`;

/* ─── Build the participant list payload from a lean exam doc ────────────────── */
const buildParticipantList = (participants = []) =>
  participants.map((p) => ({
    user: p.user,
    joinedAt: p.joinedAt,
    submittedAt: p.submittedAt ?? null,
    score: p.score ?? 0,
    status: p.submittedAt ? "Submitted" : "Joined",
  }));

/**
 * Clear any pending end timer for an exam (used when admin changes timing).
 */
export const clearExamEndTimer = (examId) => {
  const key = String(examId);
  const existing = endTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    endTimers.delete(key);
  }
};

/**
 * Schedule (or re-schedule) the exam-end broadcast.
 * Always replaces any existing timer so admin duration changes take effect.
 * If endTime is already past, ends the exam immediately.
 */
export const scheduleExamEnd = (examId, endTime) => {
  const key = String(examId);
  clearExamEndTimer(examId);

  const delay = new Date(endTime).getTime() - Date.now();
  if (delay <= 0) {
    broadcastExamEnded(examId);
    return;
  }

  const timer = setTimeout(() => {
    endTimers.delete(key);
    broadcastExamEnded(examId);
  }, delay);

  endTimers.set(key, timer);
};

/* ─── Broadcast helpers (called from controller after DB writes) ─────────────── */

/**
 * Called from joinExam controller after the atomic $push succeeds.
 * Broadcasts the new participant to everyone already in the lobby room.
 */
export const broadcastParticipantJoined = (examId, participantPayload) => {
  if (!_io) return;
  _io.to(examRoomName(examId)).emit("examParticipantJoined", participantPayload);
};

/**
 * Called from submitExam controller after the atomic findOneAndUpdate succeeds.
 * Broadcasts the submission event; if all participants submitted also fires
 * examAllSubmitted.
 *
 * @param {string} examId - The exam ID
 * @param {string} userId - The user who submitted
 * @param {object} payload - Submission details for real-time UI updates
 */
export const broadcastParticipantSubmitted = async (examId, userId, payload = {}) => {
  if (!_io) return;

  try {
    const submittedAt = payload.submittedAt ?? new Date();
    const socketPayload = {
      userId: userId.toString(),
      submittedAt,
      status: payload.status ?? "Submitted",
      score: payload.score ?? 0,
      timeSpent: payload.timeSpent ?? 0,
      correctCount: payload.correctCount ?? 0,
    };

    _io.to(examRoomName(examId)).emit("examParticipantSubmitted", socketPayload);

    const [total, submittedCount] = await Promise.all([
      ExamParticipantModel.countDocuments({ examId }),
      ExamParticipantModel.countDocuments({
        examId,
        submittedAt: { $ne: null },
      }),
    ]);

    if (total > 0 && submittedCount === total) {
      _io.to(examRoomName(examId)).emit("examAllSubmitted", {
        message: "All participants have submitted.",
      });
    }
  } catch (err) {
    console.error("[Exam Socket] broadcastParticipantSubmitted error:", err);
  }
};

/**
 * Notify connected clients that admin changed exam timing (start/end/duration).
 * Clients should update their local countdown; if endTime is past they auto-submit.
 */
export const broadcastExamTimingUpdated = (examId, timing = {}) => {
  if (!_io) return;
  _io.to(examRoomName(examId)).emit("examTimingUpdated", {
    examId: examId.toString(),
    startTime: timing.startTime ?? null,
    endTime: timing.endTime ?? null,
    duration: timing.duration ?? null,
    status: timing.status ?? null,
    serverTime: Date.now(),
  });
};

/**
 * Score and mark submittedAt for every participant who has not submitted yet.
 * Safe to call multiple times — already-submitted rows are skipped via atomic filter.
 */
export const forceSubmitUnsubmittedParticipants = async (examId) => {
  const exam = await getExamMeta(examId);
  if (!exam) return;

  const submissionTime = new Date();
  const quizDocs = await getExamQuizDocs(exam);
  const quizDocsMap = quizDocsToMap(quizDocs);
  const unsubmitted = await ExamParticipantModel.find({
    examId,
    $or: [{ submittedAt: { $exists: false } }, { submittedAt: null }],
  }).lean();

  const ops = [];
  const broadcasts = [];

  for (let i = 0; i < unsubmitted.length; i += 1) {
    const participant = unsubmitted[i];
    const userId = participant.userId;
    if (!userId) continue;

    const answersToScore = participant.answers ?? [];
    const { processedAnswers, score, correctCount } = scoreExam(
      quizDocsMap,
      answersToScore,
    );
    const timeSpent = resolveTimeSpentForSubmit(
      participant,
      exam,
      submissionTime,
    );

    ops.push({
      updateOne: {
        filter: {
          _id: participant._id,
          $or: [{ submittedAt: { $exists: false } }, { submittedAt: null }],
        },
        update: {
          $set: {
            score,
            answers: processedAnswers,
            submittedAt: submissionTime,
            timeSpent,
          },
        },
      },
    });

    broadcasts.push({
      userId: userId.toString(),
      submittedAt: submissionTime,
      score,
      timeSpent,
      correctCount,
      status: "Submitted",
    });

    if (i % 25 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (ops.length) {
    await ExamParticipantModel.bulkWrite(ops, { ordered: false });
  }

  await ExamModel.updateOne(
    { _id: examId },
    {
      $set: {
        status: "ENDED",
        isActive: false,
        resultsPublished: true,
      },
    },
  );
  await invalidateExamCache(examId);

  if (_io) {
    const room = examRoomName(examId);
    broadcasts.forEach((payload) => {
      _io.to(room).emit("examParticipantSubmitted", payload);
    });
    if (broadcasts.length) {
      _io.to(room).emit("examAllSubmitted", {
        message: "All participants have submitted.",
      });
    }
  }
};

/**
 * Fired by the server-side end timer OR when admin shortens duration past now.
 * Broadcasts examEnded so connected clients auto-submit, and force-submits
 * anyone who is disconnected / missed the client timer.
 */
export const broadcastExamEnded = (examId) => {
  const key = String(examId);
  if (endingInProgress.has(key)) return;
  endingInProgress.add(key);

  clearExamEndTimer(examId);

  if (_io) {
    _io.to(examRoomName(examId)).emit("examEnded", {
      examId: key,
      message: "Exam time is up. Submitting automatically.",
    });
  }

  forceSubmitUnsubmittedParticipants(examId)
    .catch((err) => {
      console.error("[Exam Socket] forceSubmitUnsubmittedParticipants error:", err);
    })
    .finally(() => {
      endingInProgress.delete(key);
    });
};

/* ─── Socket handler initializer ─────────────────────────────────────────────── */
export const initializeExamSocketHandlers = (io) => {
  _io = io;

  // Auth middleware is applied once globally in index.js so individual
  // namespace handlers don't need to re-apply it. But if this handler is
  // registered after the global middleware the socket already has socket.userId.

  io.on("connection", (socket) => {
    /* ── JOIN EXAM ROOM ─────────────────────────────────────────── */
    socket.on("joinExamRoom", async ({ examId }) => {
      if (!examId) return;

      try {
        socket.join(examRoomName(examId));

        // Send back the current participant list so the lobby can render
        // without waiting for a REST call.
        const [exam, participants] = await Promise.all([
          ExamModel.findById(examId).select("endTime status").lean(),
          getExamRoster(examId),
        ]);

        if (!exam) {
          socket.emit("examError", { message: "Exam not found" });
          return;
        }

        socket.emit("examRoomJoined", {
          examId: examId.toString(),
          participants,
          serverTime: Date.now(),
        });

        // Ensure the end-timer is running for LIVE exams
        if (exam.status === "LIVE" && exam.endTime) {
          scheduleExamEnd(examId, exam.endTime);
        }
      } catch (err) {
        console.error("[Exam Socket] joinExamRoom error:", err);
      }
    });

    /* ── LEAVE EXAM ROOM (explicit, optional) ───────────────────── */
    socket.on("leaveExamRoom", ({ examId }) => {
      if (examId) socket.leave(examRoomName(examId));
    });

    /* ── DISCONNECT ─────────────────────────────────────────────── */
    // Socket.IO automatically removes the socket from all rooms on disconnect.
    // No extra cleanup needed for exam rooms.
  });

  /* ── SERVER RESTART RECOVERY ──────────────────────────────────────────────
     Re-schedule end timers for any LIVE exams.
     If endTime is already past, scheduleExamEnd ends them immediately
     (broadcast + force-submit unsubmitted participants).
  ─────────────────────────────────────────────────────────────────────────── */
  const recover = async () => {
    try {
      const liveExams = await ExamModel.find({
        status: "LIVE",
      })
        .select("_id endTime")
        .lean();

      for (const exam of liveExams) {
        if (exam.endTime) scheduleExamEnd(exam._id, exam.endTime);
      }

      if (liveExams.length) {
        console.log(`[Exam Socket] Recovered end-timers for ${liveExams.length} live exam(s)`);
      }
    } catch (err) {
      console.error("[Exam Socket] Recovery error:", err);
    }
  };

  if (mongoose.connection.readyState === 1) {
    recover();
  } else {
    mongoose.connection.once("connected", () => {
      console.log("[Exam Socket] DB ready — recovering live exam timers");
      recover();
    });
  }
};
