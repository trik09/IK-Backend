import ExamModel from "../models/ExamSchema.js";
import ExamParticipantModel from "../models/ExamParticipantSchema.js";
import UserModel from "../models/UserSchema.js";
import { scoreExam, computeTotalMaxMarks, EXAM_MARKS_PER_QUESTION } from "../utils/examScoringEngine.js";
import {
  resolveParticipantTimeSpent,
  resolveTimeSpentForSubmit,
} from "../utils/examTimeUtils.js";
import {
  broadcastParticipantJoined,
  broadcastParticipantSubmitted,
  broadcastExamTimingUpdated,
  scheduleExamEnd,
} from "../utils/socketExamHandlers.js";
import {
  getQuizIdsFromExam,
  incrementQuizUsageCounts,
  decrementQuizUsageCounts,
  syncQuizUsageCounts,
} from "../utils/quizUsageCount.js";
import {
  attachSanitizedQuizzes,
  getCachedLeaderboardPayload,
  getExamEndTime,
  getExamMeta,
  getExamQuizDocs,
  getExamRoster,
  getMyExamParticipant,
  getSanitizedExamPaper,
  invalidateExamCache,
  invalidateExamRoster,
  quizDocsToMap,
  setCachedLeaderboardPayload,
  toApiParticipant,
  toObjectId,
} from "../utils/examCache.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Compute the correct status string from startTime and endTime.
 * Mirrors the exact same logic used in competition.controller.js.
 *
 * Concurrency note: status is intentionally NOT the single source of truth —
 * every read-path (getExamById, getPublicExams, etc.) re-derives the effective
 * status from wall-clock time, just like competitions do. The stored status is
 * only a cached hint used for index-accelerated queries.
 */
function computeStatus(startTime, endTime) {
  const now   = new Date();
  const start = new Date(startTime);
  const end   = new Date(endTime);

  if (now >= start && now <= end) return "LIVE";
  if (now > end)                  return "ENDED";
  return "UPCOMING";
}

/**
 * Derive the effective (real-time) status from a plain exam object.
 * Returns the exam status as it is RIGHT NOW regardless of what the DB says.
 *
 * This is the competition pattern: compute on read, fix DB asynchronously
 * in the background (fire-and-forget) so the response is never blocked.
 */
function effectiveStatus(exam) {
  const now   = new Date();
  const start = new Date(exam.startTime);
  const end   = new Date(exam.endTime);

  if (now >= start && now <= end) return "LIVE";
  if (now > end)                  return "ENDED";
  return "UPCOMING";
}

function pickAnswerFields(body = {}) {
  const fields = {};
  const assign = (key, fallback) => {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      fields[key] = body[key] ?? fallback;
    }
  };
  assign("selectedOption", null);
  assign("textAnswer", null);
  assign("matchedPairs", []);
  assign("sequenceAnswer", []);
  assign("boardMove", null);
  assign("pieceValueAnswer", []);
  assign("pieceCombinationAnswer", []);
  assign("boardBuilderAnswer", null);
  return fields;
}


// ═════════════════════════════════════════════════════════════════════════════
// ADMIN CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Create Exam ─────────────────────────────────────────────────────────────
export const createExam = async (req, res) => {
  try {
    const {
      name, description, startTime, endTime, duration, chapters,
      isActive, maxParticipants, accessCode, resultsPublished
    } = req.body;

    // Validate required fields
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ message: "Name, startTime, and endTime are required" });
    }

    // Logical time-range check
    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ message: "endTime must be after startTime" });
    }

    // Compute initial status from real wall-clock time (same as competition)
    const status = computeStatus(startTime, endTime);

    const exam = await ExamModel.create({
      name,
      description,
      startTime,
      endTime,
      duration,
      chapters:         chapters || [],
      isActive:         isActive ?? false,
      maxParticipants,
      accessCode:       accessCode || undefined,
      resultsPublished: resultsPublished ?? false,
      status,
      // Superadmin token has no _id in DB — use id || _id to handle both cases
      createdBy:        req.admin?.id || req.admin?._id,
    });

    await incrementQuizUsageCounts(getQuizIdsFromExam(exam));

    res.status(201).json({ message: "Exam created successfully", exam });
  } catch (error) {
    console.error("Error creating exam:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Admin Exam List (paginated + searchable) ─────────────────────────────────
export const getAdminExams = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", status } = req.query;
    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip     = (pageNum - 1) * limitNum;

    const now = new Date();
    const query = {};
    if (status) {
      const s = status.toUpperCase();
      if (s === "LIVE") {
        query.$or = [
          { status: "LIVE",     endTime: { $gt: now } },
          { status: "UPCOMING", startTime: { $lte: now }, endTime: { $gt: now } }
        ];
      } else if (s === "UPCOMING") {
        query.status    = "UPCOMING";
        query.startTime = { $gt: now };
      } else if (s === "ENDED") {
        query.$or = [{ status: "ENDED" }, { endTime: { $lte: now } }];
      } else {
        query.status = s;
      }
    }
    if (search) {
      const searchCondition = {
        $or: [
          { name:        { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } }
        ]
      };
      if (query.$or) {
        query.$and = [{ $or: query.$or }, searchCondition];
        delete query.$or;
      } else {
        query.$or = searchCondition.$or;
      }
    }

    // Parallel fetch — same pattern as quiz.controller.js
    const [exams, totalCount] = await Promise.all([
      ExamModel.find(query).sort({ startTime: -1 }).skip(skip).limit(limitNum).lean(),
      ExamModel.countDocuments(query)
    ]);

    // Async DB fix for stale status
    const staleExams = exams.filter(e => {
      if (e.status === "UPCOMING" && new Date(e.startTime) <= now && new Date(e.endTime) > now) return true;
      if (e.status !== "ENDED" && new Date(e.endTime) <= now) return true;
      return false;
    });

    if (staleExams.length) {
      const toLive = staleExams.filter(e => new Date(e.endTime) > now);
      const toEnded = staleExams.filter(e => new Date(e.endTime) <= now);
      
      if (toLive.length) {
        ExamModel.updateMany(
          { _id: { $in: toLive.map(e => e._id) } },
          { $set: { status: "LIVE", isActive: true } }
        ).catch(() => {});
      }
      
      if (toEnded.length) {
        ExamModel.updateMany(
          { _id: { $in: toEnded.map(e => e._id) } },
          { $set: { status: "ENDED", isActive: false } }
        ).catch(() => {});
      }
    }

    const enriched = exams.map(e => ({
      ...e,
      status: effectiveStatus(e)
    }));

    res.status(200).json({
      exams: enriched,
      currentPage: pageNum,
      totalPages:  Math.ceil(totalCount / limitNum),
      totalCount
    });
  } catch (error) {
    console.error("Error fetching exams:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─── Admin: Get Single Exam (full detail, no answer-key redaction) ────────────
export const getExamById = async (req, res) => {
  try {
    const exam = await ExamModel.findById(req.params.id)
      .populate("chapters.quizIds")
      .select("-participants")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const now    = new Date();
    const start  = new Date(exam.startTime);
    const end    = new Date(exam.endTime);

    if (exam.status === "UPCOMING" && now >= start && now <= end) {
      exam.status  = "LIVE";
      exam.isActive = true;
      ExamModel.updateOne({ _id: exam._id }, { status: "LIVE", isActive: true }).catch(() => {});
    } else if (exam.status !== "ENDED" && now > end) {
      exam.status  = "ENDED";
      exam.isActive = false;
      ExamModel.updateOne({ _id: exam._id }, { status: "ENDED", isActive: false }).catch(() => {});
    }

    const participants = await getExamRoster(exam._id);
    res.status(200).json({ ...exam, participants });
  } catch (error) {
    console.error("Error fetching exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Update Exam ──────────────────────────────────────────────────────────────
export const updateExam = async (req, res) => {
  try {
    const { id } = req.params;

    // ── CONCURRENCY FIX: use findById(lean) then findByIdAndUpdate ───────────
    // Avoids loading + re-saving the entire document with its potentially large
    // participants[] array. Only the explicitly listed fields are touched.
    // (Same approach as competition.controller.js updateCompetition)
    const existing = await ExamModel
      .findById(id)
      .select("_id startTime endTime duration status chapters")
      .lean();

    if (!existing) return res.status(404).json({ message: "Exam not found" });

    const updates = req.body;

    // ── Recompute status if timing fields changed ─────────────────────────────
    // Mirrors competition controller exactly: derive from actual clock time.
    if (updates.startTime || updates.endTime || updates.duration) {
      const newStart = new Date(updates.startTime || existing.startTime);
      const newEnd   = new Date(updates.endTime   || existing.endTime);

      if (newEnd <= newStart) {
        return res.status(400).json({ message: "endTime must be after startTime" });
      }

      updates.status   = computeStatus(newStart, newEnd);
      updates.isActive = updates.status === "LIVE";
    }

    // ── Handle unset of optional fields ──────────────────────────────────────
    // Empty string / null means "remove this field entirely"
    const $unset = {};
    if (updates.accessCode    === "" || updates.accessCode    === null) {
      delete updates.accessCode;
      $unset.accessCode = "";
    }
    if (updates.maxParticipants === "" || updates.maxParticipants === null) {
      delete updates.maxParticipants;
      $unset.maxParticipants = "";
    }

    // ── Build a strict $set from allowed fields only ──────────────────────────
    // Prevents a caller from accidentally overwriting internal fields like
    // participants[], createdBy, or createdAt via the request body.
    const ALLOWED = [
      "name", "description", "startTime", "endTime", "duration",
      "chapters", "isActive", "maxParticipants", "accessCode",
      "resultsPublished", "status"
    ];

    const $set = { updatedAt: new Date() };
    for (const field of ALLOWED) {
      if (updates[field] !== undefined) $set[field] = updates[field];
    }

    const updateOp = { $set };
    if (Object.keys($unset).length) updateOp.$unset = $unset;

    const previousQuizIds = getQuizIdsFromExam(existing);

    const updated = await ExamModel.findByIdAndUpdate(id, updateOp, {
      new:          true,
      runValidators: false   // skip — we validated manually above
    });

    if (updates.chapters !== undefined) {
      await syncQuizUsageCounts(previousQuizIds, getQuizIdsFromExam(updated));
    }

    // When admin changes timing on a live / soon-to-end exam, push the new
    // endTime to connected clients and re-schedule the server end timer so
    // auto-submit fires at the updated deadline (not the original one).
    const timingTouched =
      updates.startTime !== undefined ||
      updates.endTime !== undefined ||
      updates.duration !== undefined;

    await invalidateExamCache(id);

    if (timingTouched && updated?.endTime) {
      broadcastExamTimingUpdated(id, {
        startTime: updated.startTime,
        endTime: updated.endTime,
        duration: updated.duration,
        status: updated.status,
      });

      const effectiveStatus =
        updated.status ||
        computeStatus(updated.startTime, updated.endTime);

      if (effectiveStatus === "LIVE" || effectiveStatus === "ENDED") {
        scheduleExamEnd(id, updated.endTime);
      }
    }

    res.status(200).json({ message: "Exam updated successfully", exam: updated });
  } catch (error) {
    console.error("Error updating exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─── Delete Exam ──────────────────────────────────────────────────────────────
export const deleteExam = async (req, res) => {
  try {
    const exam = await ExamModel.findByIdAndDelete(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    await Promise.all([
      decrementQuizUsageCounts(getQuizIdsFromExam(exam)),
      ExamParticipantModel.deleteMany({ examId: exam._id }),
      invalidateExamCache(exam._id),
    ]);

    res.status(200).json({ message: "Exam deleted successfully" });
  } catch (error) {
    console.error("Error deleting exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// USER CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Public: List Active Exams (paginated) ────────────────────────────────────
export const getPublicExams = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip     = (pageNum - 1) * limitNum;
    const now      = new Date();

    // ── Build query — same stale-status pattern as competitions ──────────────
    // When status=LIVE we also catch UPCOMING exams that have already started
    // but whose DB status hasn't been corrected yet.
    const query = { isActive: true };

    if (status) {
      const s = status.toUpperCase();
      if (s === "LIVE") {
        query.$or = [
          { status: "LIVE",     endTime: { $gt: now } },
          { status: "UPCOMING", startTime: { $lte: now }, endTime: { $gt: now } }
        ];
        delete query.isActive; // LIVE filter supersedes isActive
      } else if (s === "UPCOMING") {
        query.status    = "UPCOMING";
        query.startTime = { $gt: now };
      } else if (s === "ENDED") {
        query.$or = [{ status: "ENDED" }, { endTime: { $lte: now } }];
        delete query.isActive;
      } else {
        query.status = s;
      }
    }

    const [exams, totalCount] = await Promise.all([
      ExamModel.find(query)
        .sort({ startTime: 1 })
        .skip(skip)
        .limit(limitNum)
        // Strip quiz content and participant data from listing — only metadata needed
        .select("-chapters.quizIds -participants")
        .lean(),
      ExamModel.countDocuments(query)
    ]);

    // Async: fix stale statuses in background (competition pattern)
    const staleExams = exams.filter(e => {
      if (e.status === "UPCOMING" && new Date(e.startTime) <= now && new Date(e.endTime) > now) return true;
      if (e.status !== "ENDED" && new Date(e.endTime) <= now) return true;
      return false;
    });

    if (staleExams.length) {
      const toLive = staleExams.filter(e => new Date(e.endTime) > now);
      const toEnded = staleExams.filter(e => new Date(e.endTime) <= now);
      
      if (toLive.length) {
        ExamModel.updateMany(
          { _id: { $in: toLive.map(e => e._id) } },
          { $set: { status: "LIVE", isActive: true } }
        ).catch(() => {});
      }
      
      if (toEnded.length) {
        ExamModel.updateMany(
          { _id: { $in: toEnded.map(e => e._id) } },
          { $set: { status: "ENDED", isActive: false } }
        ).catch(() => {});
      }
    }

    // Return effective status (computed from time) for each exam
    const enriched = exams.map(e => ({
      ...e,
      status: effectiveStatus(e)
    }));

    res.status(200).json({
      exams: enriched,
      currentPage: pageNum,
      totalPages:  Math.ceil(totalCount / limitNum),
      totalCount
    });
  } catch (error) {
    console.error("Error fetching public exams:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Public: Get Exam Details for Student (answer keys stripped) ──────────────
export const getExamDetailsForUser = async (req, res) => {
  try {
    const userId = req.user._id;
    const view = String(req.query.view || "").toLowerCase();
    const wantPaper = view !== "lobby";

    const exam = await getExamMeta(req.params.id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const effective = computeStatus(exam.startTime, exam.endTime);

    if (effective === "LIVE" && (exam.status !== "LIVE" || !exam.isActive)) {
      exam.status = "LIVE";
      exam.isActive = true;
      ExamModel.updateOne({ _id: exam._id }, { status: "LIVE", isActive: true }).catch(() => {});
    } else if (effective === "ENDED" && exam.status !== "ENDED") {
      exam.status = "ENDED";
      exam.isActive = false;
      const endedUpdate = { status: "ENDED", isActive: false };
      if (!exam.resultsPublished) {
        endedUpdate.resultsPublished = true;
        exam.resultsPublished = true;
      }
      ExamModel.updateOne({ _id: exam._id }, { $set: endedUpdate }).catch(() => {});
    }

    const myParticipant = await getMyExamParticipant(req.params.id, userId);
    const isParticipant = !!myParticipant;

    if (isParticipant && effective === "LIVE") {
      if (!myParticipant.submittedAt && !myParticipant.startedAt) {
        const examStartMs = new Date(exam.startTime).getTime();
        const joinedMs = myParticipant.joinedAt
          ? new Date(myParticipant.joinedAt).getTime()
          : examStartMs;
        const sessionStart = new Date(Math.max(examStartMs, joinedMs));
        await ExamParticipantModel.updateOne(
          { _id: myParticipant._id },
          { $set: { startedAt: sessionStart } }
        );
        myParticipant.startedAt = sessionStart;
        invalidateExamRoster(req.params.id).catch(() => {});
      }
    }

    if (!isParticipant) {
      if (!exam.isActive && effective === "UPCOMING") {
        return res.status(404).json({ message: "Exam not found or not active" });
      }
      if (effective === "ENDED") {
        return res.status(404).json({ message: "Exam not found or not active" });
      }
    }

    const { participants: _ignored, accessCode: _code, ...examWithoutEmbedded } = exam;
    let payload;
    let participants;
    let participantCount;

    if (wantPaper) {
      payload = await getSanitizedExamPaper(examWithoutEmbedded);
      const meRow = myParticipant
        ? toApiParticipant(myParticipant, { viewerId: userId, includeAnswers: true })
        : null;
      participants = meRow ? [meRow] : [];
      participantCount = participants.length;
    } else {
      const roster = await getExamRoster(req.params.id);
      participants = roster;
      participantCount = roster.length;
      payload = {
        ...examWithoutEmbedded,
        chapters: (exam.chapters || []).map((ch) => ({
          name: ch.name,
          quizIds: (ch.quizIds || []).map((q) => q?._id || q),
        })),
      };
    }

    payload.status = effective;
    payload.participants = participants;
    payload.participantCount = participantCount;
    delete payload.accessCode;

    res.status(200).json(payload);
  } catch (error) {
    console.error("Error fetching exam details:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Join Exam ────────────────────────────────────────────────────────────────
export const joinExam = async (req, res) => {
  try {
    const { id }        = req.params;
    const { accessCode } = req.body;
    const userId        = req.user._id;

    const exam = await getExamMeta(id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const now   = new Date();
    const start = new Date(exam.startTime);
    const end   = new Date(exam.endTime);

    if (now > end) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    if (exam.accessCode && exam.accessCode !== accessCode) {
      return res.status(403).json({ message: "Invalid access code", requireCode: true });
    }

    if (exam.maxParticipants) {
      const participantCount = await ExamParticipantModel.countDocuments({ examId: id });
      if (participantCount >= exam.maxParticipants) {
        return res.status(400).json({ message: "Exam is full" });
      }
    }

    try {
      await ExamParticipantModel.create({
        examId: id,
        userId,
        joinedAt: new Date(),
        submittedAt: null,
        score: 0,
        correctCount: 0,
        timeSpent: 0,
        answers: [],
      });
    } catch (createError) {
      if (createError?.code === 11000) {
        return res.status(400).json({ message: "Already joined this exam" });
      }
      throw createError;
    }

    if (now >= start && now <= end && (exam.status !== "LIVE" || !exam.isActive)) {
      ExamModel.updateOne(
        { _id: id },
        { $set: { status: "LIVE", isActive: true } }
      ).catch(() => {});
    }

    invalidateExamRoster(id).catch(() => {});

    setImmediate(() => {
      UserModel.findById(userId)
        .select("name username avatar")
        .lean()
        .then((userDoc) => {
          broadcastParticipantJoined(id, {
            user: {
              _id:      userId.toString(),
              name:     userDoc?.name     ?? null,
              username: userDoc?.username ?? null,
              avatar:   userDoc?.avatar   ?? null,
            },
            joinedAt:    new Date(),
            submittedAt: null,
            status:      "Joined",
          });
        })
        .catch((err) => {
          console.error("[joinExam] socket broadcast error:", err);
        });
    });

    scheduleExamEnd(id, exam.endTime, { ifAbsent: true });

    res.status(200).json({
      message: "Joined exam successfully",
    });
  } catch (error) {
    console.error("Error joining exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Save / Update a Single Answer (accumulates active time per question) ─────
export const saveAnswer = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user._id;
    const { quizId, timeSpent: rawTimeSpent } = req.body;

    if (!quizId) {
      return res.status(400).json({ message: "quizId is required" });
    }

    const quizObjectId = toObjectId(quizId);
    if (!quizObjectId) {
      return res.status(400).json({ message: "quizId is invalid" });
    }

    const seconds = Number(rawTimeSpent);
    const timeIncrement = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;

    const endTime = await getExamEndTime(id);
    if (!endTime) return res.status(404).json({ message: "Exam not found" });
    if (new Date() > new Date(endTime)) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    const answerFields = pickAnswerFields(req.body);
    const notSubmitted = {
      examId: id,
      userId,
      $or: [{ submittedAt: null }, { submittedAt: { $exists: false } }],
    };
    const positionalSet = Object.fromEntries(
      Object.entries(answerFields).map(([key, value]) => [`answers.$.${key}`, value])
    );

    const updatedExisting = await ExamParticipantModel.updateOne(
      { ...notSubmitted, "answers.quizId": quizObjectId },
      {
        $inc: {
          timeSpent: timeIncrement,
          "answers.$.questionTimeSpent": timeIncrement,
        },
        ...(Object.keys(positionalSet).length ? { $set: positionalSet } : {}),
      }
    );

    if (updatedExisting.matchedCount > 0) {
      return res.status(200).json({ message: "Answer saved", timeIncrement });
    }

    const inserted = await ExamParticipantModel.updateOne(
      notSubmitted,
      {
        $inc: { timeSpent: timeIncrement },
        $push: {
          answers: {
            quizId: quizObjectId,
            questionTimeSpent: timeIncrement,
            ...answerFields,
          },
        },
      }
    );

    if (inserted.matchedCount === 0) {
      const existing = await ExamParticipantModel.findOne({ examId: id, userId })
        .select("submittedAt")
        .lean();
      if (!existing) {
        return res.status(403).json({ message: "You have not joined this exam" });
      }
      if (existing.submittedAt) {
        return res.status(400).json({ message: "Exam already submitted" });
      }
    }

    res.status(200).json({ message: "Answer saved", timeIncrement });
  } catch (error) {
    console.error("Error saving answer:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const submitExam = async (req, res) => {
  try {
    const { id }  = req.params;
    const userId  = req.user._id;
    const { answers: submittedAnswers } = req.body;

    const exam = await getExamMeta(id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const gracePeriodMs = 60 * 1000;
    const submissionTime = new Date();
    if (submissionTime > new Date(new Date(exam.endTime).getTime() + gracePeriodMs)) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    const participant = await getMyExamParticipant(id, userId);
    if (!participant) {
      return res.status(400).json({ message: "You have not joined this exam" });
    }
    if (participant.submittedAt) {
      return res.status(400).json({ message: "You have already submitted this exam" });
    }

    const totalActiveTimeSpent = resolveTimeSpentForSubmit(
      participant,
      exam,
      submissionTime,
    );

    const answersToScore = submittedAnswers && submittedAnswers.length > 0
      ? submittedAnswers
      : participant.answers ?? [];

    const quizDocs = await getExamQuizDocs(exam);
    const quizDocsMap = quizDocsToMap(quizDocs);
    const { processedAnswers, score, totalQuestions, correctCount } =
      scoreExam(quizDocsMap, answersToScore);
    const questionCount = getQuizIdsFromExam(exam).length || totalQuestions;
    const totalMaxMarks = computeTotalMaxMarks(exam, questionCount);

    const updateResult = await ExamParticipantModel.updateOne(
      {
        examId: id,
        userId,
        $or: [{ submittedAt: { $exists: false } }, { submittedAt: null }],
      },
      {
        $set: {
          score,
          correctCount,
          answers: processedAnswers,
          submittedAt: submissionTime,
          timeSpent: totalActiveTimeSpent,
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(400).json({ message: "You have already submitted this exam" });
    }

    invalidateExamRoster(id).catch(() => {});

    if (!exam.resultsPublished) {
      Promise.all([
        ExamParticipantModel.countDocuments({ examId: id }),
        ExamParticipantModel.countDocuments({
          examId: id,
          submittedAt: { $ne: null },
        }),
      ])
        .then(([total, submittedCount]) => {
          if (total > 0 && submittedCount === total) {
            ExamModel.updateOne(
              { _id: id },
              { $set: { resultsPublished: true } }
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }

    broadcastParticipantSubmitted(id, userId, {
      submittedAt: submissionTime,
      score,
      timeSpent: totalActiveTimeSpent,
      correctCount,
      status: "Submitted",
    }).catch((err) => {
      console.error("[submitExam] socket broadcast error:", err);
    });

    res.status(200).json({
      message:        "Exam submitted successfully",
      score,
      totalMaxMarks,
      timeSpent:      totalActiveTimeSpent,
      totalQuestions: questionCount,
      correctCount,
    });
  } catch (error) {
    console.error("Error submitting exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
// ─── Get Exam Results (student) ───────────────────────────────────────────────
export const getExamResults = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const view = String(req.query.view || "").toLowerCase();
    const leaderboardOnly = view === "leaderboard";

    if (leaderboardOnly) {
      const cached = await getCachedLeaderboardPayload(id);
      if (cached) {
        const mine = (cached.examDetails?.participants || []).find((p) => {
          const pId = p.user?._id ? p.user._id.toString() : p.user?.toString?.();
          return pId === userId.toString();
        });
        if (mine) {
          return res.status(200).json({
            ...cached,
            score: mine.score,
            timeSpent: mine.timeSpent,
            correctCount: mine.correctCount,
          });
        }
      }
    }

    const exam = await getExamMeta(id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const effectiveExamStatus = effectiveStatus(exam);
    if (effectiveExamStatus === "ENDED") {
      if (!exam.resultsPublished) {
        exam.resultsPublished = true;
        ExamModel.updateOne(
          { _id: exam._id },
          { $set: { resultsPublished: true, status: "ENDED", isActive: false } }
        ).catch(() => {});
      }
      scheduleExamEnd(id, exam.endTime, { ifAbsent: true });
    }

    const participantDocs = await ExamParticipantModel.find({ examId: id })
      .select("userId joinedAt startedAt submittedAt score timeSpent correctCount")
      .populate("userId", "name username avatar profilePicture")
      .lean();

    const mappedParticipants = participantDocs.map((p) => {
      const pScore = p.submittedAt ? (p.score ?? 0) : (p.score ?? 0);
      const apiRow = {
        user: p.userId,
        joinedAt: p.joinedAt,
        startedAt: p.startedAt ?? null,
        submittedAt: p.submittedAt ?? null,
        score: pScore,
        timeSpent: p.timeSpent ?? 0,
      };
      const pTimeSpent = resolveParticipantTimeSpent(apiRow, exam);
      return {
        user: p.userId,
        score: pScore,
        correctCount: p.correctCount ?? 0,
        timeSpent: pTimeSpent,
        joinedAt: p.joinedAt,
        startedAt: p.startedAt ?? null,
        submittedAt: p.submittedAt ?? null,
        status: p.submittedAt ? "Submitted" : "Joined",
      };
    });

    const participant = mappedParticipants.find((p) => {
      const pId = p.user?._id ? p.user._id.toString() : p.user?.toString?.();
      return pId === userId.toString();
    });

    if (!participant) {
      return res.status(404).json({
        message: "You haven't participated in this exam so you cannot see the leaderboard.",
      });
    }

    if (!exam.resultsPublished && !participant.submittedAt) {
      return res.status(403).json({ message: "Results have not been published yet" });
    }

    const totalQuestions = (exam.chapters || []).reduce(
      (sum, ch) => sum + (ch.quizIds?.length ?? 0),
      0
    );
    const totalMaxMarks = computeTotalMaxMarks(exam, totalQuestions);

    let myAnswers = [];
    if (!leaderboardOnly) {
      const mine = await ExamParticipantModel.findOne({ examId: id, userId })
        .select("answers")
        .lean();
      myAnswers = mine?.answers ?? [];
    }

    const correctCount =
      participant.correctCount ||
      myAnswers.filter((a) => a.isCorrect).length;

    let chapters;
    if (leaderboardOnly) {
      chapters = (exam.chapters || []).map((ch) => ({
        name: ch.name,
        title: ch.title,
        quizIds: Array.isArray(ch.quizIds) ? ch.quizIds.map((q) => q?._id || q) : [],
      }));
    } else {
      const quizDocs = await getExamQuizDocs(exam);
      chapters = attachSanitizedQuizzes(exam, quizDocs).chapters;
    }

    const examDetails = {
      _id: exam._id,
      name: exam.name,
      title: exam.name,
      description: exam.description,
      startTime: exam.startTime,
      endTime: exam.endTime,
      duration: exam.duration,
      status: effectiveStatus(exam),
      resultsPublished: exam.resultsPublished,
      chapters,
      participants: mappedParticipants,
    };

    const participantTimeSpent = resolveParticipantTimeSpent(participant, exam);
    const participantScore = participant.submittedAt
      ? (participant.score ?? correctCount * EXAM_MARKS_PER_QUESTION)
      : (participant.score ?? 0);

    const payload = {
      score: participantScore,
      totalMaxMarks,
      timeSpent: participantTimeSpent,
      totalQuestions,
      correctCount,
      answers: leaderboardOnly ? [] : myAnswers,
      examDetails,
      view: leaderboardOnly ? "leaderboard" : "full",
    };

    if (leaderboardOnly && exam.resultsPublished) {
      setCachedLeaderboardPayload(id, payload).catch(() => {});
    }

    res.status(200).json(payload);
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const getExamLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;
    const exam = await ExamModel.findById(id)
      .select("resultsPublished name status startTime endTime")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (!exam.resultsPublished && effectiveStatus(exam) !== "ENDED") {
      return res.status(403).json({ message: "Results have not been published yet" });
    }

    const roster = await getExamRoster(id);
    const leaderboard = buildLeaderboard(roster);

    res.status(200).json({
      leaderboard,
      totalParticipants: roster.length,
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const getAdminExamLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;
    const exam = await ExamModel.findById(id)
      .select("name status resultsPublished")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const roster = await getExamRoster(id);
    const leaderboard = buildLeaderboard(roster);

    res.status(200).json({
      leaderboard,
      totalParticipants: roster.length,
      resultsPublished: exam.resultsPublished,
    });
  } catch (error) {
    console.error("Error fetching admin leaderboard:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

/**
 * Sort participants by score desc, timeSpent asc, assign sequential ranks.
 * Pure function — no DB access.
 */
function buildLeaderboard(participants = []) {
  return [...participants]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;  // higher score first
      return (a.timeSpent ?? 0) - (b.timeSpent ?? 0);     // faster wins tie
    })
    .map((p, index) => ({
      rank:      index + 1,
      userId:    p.user?._id ?? p.user,
      username:  p.user?.username ?? p.user?.name ?? "—",
      avatar:    p.user?.avatar   ?? null,
      score:     p.score     ?? 0,
      timeSpent: p.timeSpent ?? 0,
      submittedAt: p.submittedAt ?? null
    }));
}

