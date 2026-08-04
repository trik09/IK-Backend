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
 *
 * Events emitted BY client → server:
 *  joinExamRoom            – join the socket room for a given examId
 *  leaveExamRoom           – leave the room (optional, auto on disconnect)
 */

import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import ExamModel from "../models/ExamSchema.js";

/* ─── Module-level io reference ─────────────────────────────────────────────── */
let _io = null;
export const getExamIO = () => _io;

/* ─── Scheduled end timers  (examId → NodeJS.Timeout) ───────────────────────── */
const endTimers = new Map();

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

/* ─── Schedule exam-end broadcast ───────────────────────────────────────────── */
export const scheduleExamEnd = (examId, endTime) => {
  // Don't double-schedule
  if (endTimers.has(String(examId))) return;

  const delay = new Date(endTime).getTime() - Date.now();
  if (delay <= 0) return; // already ended

  const timer = setTimeout(() => {
    endTimers.delete(String(examId));
    broadcastExamEnded(examId);
  }, delay);

  endTimers.set(String(examId), timer);
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

    console.log("[Exam Socket] broadcastParticipantSubmitted:", {
      examId,
      ...socketPayload,
    });

    _io.to(examRoomName(examId)).emit("examParticipantSubmitted", socketPayload);

    console.log("[Exam Socket] Emitted examParticipantSubmitted to room:", examRoomName(examId));

    // Fetch fresh data to check if everyone is done
    const exam = await ExamModel.findById(examId)
      .select("participants.submittedAt")
      .lean();

    if (!exam) return;

    // Check if everyone is done
    const total = exam.participants.length;
    const submittedCount = exam.participants.filter((p) => !!p.submittedAt).length;

    console.log("[Exam Socket] Submission check:", { total, submittedCount });

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
 * Fired by the server-side end timer OR when the cron job detects exam end.
 */
export const broadcastExamEnded = (examId) => {
  if (!_io) return;
  _io.to(examRoomName(examId)).emit("examEnded", {
    examId: examId.toString(),
    message: "Exam time is up. Submitting automatically.",
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
        const exam = await ExamModel.findById(examId)
          .select("participants endTime status")
          .populate("participants.user", "name username avatar")
          .lean();

        if (!exam) {
          socket.emit("examError", { message: "Exam not found" });
          return;
        }

        socket.emit("examRoomJoined", {
          examId: examId.toString(),
          participants: buildParticipantList(exam.participants),
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
     Re-schedule end timers for any LIVE exams whose endTime is in the future.
     This prevents exams from silently expiring without the broadcast when
     the server restarts mid-exam.
  ─────────────────────────────────────────────────────────────────────────── */
  const recover = async () => {
    try {
      const liveExams = await ExamModel.find({
        status: "LIVE",
        endTime: { $gt: new Date() },
      })
        .select("_id endTime")
        .lean();

      for (const exam of liveExams) {
        scheduleExamEnd(exam._id, exam.endTime);
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
