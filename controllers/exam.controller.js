import ExamModel from "../models/ExamSchema.js";
import QuizModel from "../models/QuizSchema.js";
import { scoreExam, buildQuizMap, computeTotalMaxMarks, EXAM_MARKS_PER_QUESTION } from "../utils/examScoringEngine.js";
import {
  computeWallClockTimeSpent,
  resolveParticipantTimeSpent,
} from "../utils/examTimeUtils.js";
import {
  broadcastParticipantJoined,
  broadcastParticipantSubmitted,
  scheduleExamEnd,
} from "../utils/socketExamHandlers.js";

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


// ═════════════════════════════════════════════════════════════════════════════
// ADMIN CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Create Exam ─────────────────────────────────────────────────────────────
export const createExam = async (req, res) => {
  try {
    const {
      name, description, startTime, endTime, duration, chapters,
      isActive, maxParticipants, accessCode, resultsPublished, visibility
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
      visibility:       visibility || "Public",
      // Superadmin token has no _id in DB — use id || _id to handle both cases
      createdBy:        req.admin?.id || req.admin?._id,
    });

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
    const { page = 1, limit = 10, search = "", status, visibility } = req.query;
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

    if (visibility) {
      if (visibility === "Event") {
        query.visibility = "Event";
      } else if (visibility === "Public") {
        query.visibility = { $ne: "Event" };
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
      .populate("participants.user", "name email username avatar");

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // ── Stale-status correction (competition pattern) ─────────────────────
    // Compute real status from time. If it differs, fix DB in background.
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

    res.status(200).json(exam);
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
      .select("_id startTime endTime duration status")
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
      "resultsPublished", "status", "visibility"
    ];

    const $set = { updatedAt: new Date() };
    for (const field of ALLOWED) {
      if (updates[field] !== undefined) $set[field] = updates[field];
    }

    const updateOp = { $set };
    if (Object.keys($unset).length) updateOp.$unset = $unset;

    const updated = await ExamModel.findByIdAndUpdate(id, updateOp, {
      new:          true,
      runValidators: false   // skip — we validated manually above
    });

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
    const query = { isActive: true, visibility: { $ne: "Event" } };

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


// ─── Helper: strip answer keys per quiz type before sending to student ────────
function sanitizeQuizForUser(quiz) {
  const q = { ...quiz };

  switch (q.type) {
    case "mcq":
    case "yes_no":
    case "fill_in_the_blank":
      // Remove isCorrect from every option — student must not see which is correct
      q.options = (q.options ?? []).map(({ isCorrect, ...rest }) => rest);
      break;

    case "column_matching":
      // Keep leftItem and rightItem (frontend shuffles rightItems for drag-drop),
      // but remove any explicit correctAnswer field if present
      q.pairs = (q.pairs ?? []).map(({ correctAnswer, ...rest }) => rest);
      break;

    case "board_move_challenge":
      // Remove the accepted moves list and the single correct move hint
      if (q.boardMoveChallenge) {
        const { correctMove, acceptedMoves, ...safe } = q.boardMoveChallenge;
        q.boardMoveChallenge = safe;
      }
      delete q.correctMove;
      delete q.acceptedMoves;
      break;

    case "piece_combination":
      // Remove requiredPieces so student can't read the answer
      if (q.pieceCombination) {
        const { requiredPieces, ...safe } = q.pieceCombination;
        q.pieceCombination = safe;
      }
      break;

    case "sequence_ordering":
      // Send items but strip their `order` field — frontend renders them shuffled
      if (q.sequenceOrdering) {
        q.sequenceOrdering = {
          ...q.sequenceOrdering,
          sequenceItems: (q.sequenceOrdering.sequenceItems ?? []).map(
            ({ order, ...rest }) => rest
          )
        };
      }
      break;

    case "piece_value":
      // Send piece names but not their values — student must fill those in
      if (q.pieceValue) {
        q.pieceValue = {
          ...q.pieceValue,
          pieceValues: (q.pieceValue.pieceValues ?? []).map(({ value, ...rest }) => rest)
        };
      }
      break;

    case "board_builder":
      // Strip the stored solutions — student must not see the answer
      delete q.correctSolution;
      delete q.exampleSolution;
      delete q.alternateSolutions;
      break;

    default:
      break;
  }

  return q;
}

// ─── Public: Get Exam Details for Student (answer keys stripped) ──────────────
export const getExamDetailsForUser = async (req, res) => {
  try {
    const userId = req.user._id;
    const exam = await ExamModel.findById(req.params.id)
      .populate("chapters.quizIds")
      .populate("participants.user", "name username avatar profilePicture");

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // ── Stale-status correction (competition pattern) ─────────────────────────
    // Always derive from wall-clock time — stored status/isActive can lag.
    const now = new Date();
    const effective = computeStatus(exam.startTime, exam.endTime);

    if (effective === "LIVE" && (exam.status !== "LIVE" || !exam.isActive)) {
      exam.status = "LIVE";
      exam.isActive = true;
      ExamModel.updateOne({ _id: exam._id }, { status: "LIVE", isActive: true }).catch(() => {});
    } else if (effective === "ENDED" && exam.status !== "ENDED") {
      exam.status = "ENDED";
      exam.isActive = false;
      // Auto-publish results when the exam ends so students can see the leaderboard.
      const endedUpdate = { status: "ENDED", isActive: false };
      if (!exam.resultsPublished) {
        endedUpdate.resultsPublished = true;
        exam.resultsPublished = true; // reflect in-memory so response carries the updated value
      }
      ExamModel.updateOne({ _id: exam._id }, { $set: endedUpdate }).catch(() => {});
    }

    const isParticipant = exam.participants.some((p) => {
      const pId = p.user?._id ? p.user._id.toString() : p.user?.toString?.();
      return pId === userId.toString();
    });

    // Record when the student first opens the take-exam view (session start).
    if (isParticipant && effective === "LIVE") {
      const myParticipant = exam.participants.find((p) => {
        const pId = p.user?._id ? p.user._id.toString() : p.user?.toString?.();
        return pId === userId.toString();
      });
      if (myParticipant && !myParticipant.submittedAt && !myParticipant.startedAt) {
        const examStartMs = new Date(exam.startTime).getTime();
        const joinedMs = myParticipant.joinedAt
          ? new Date(myParticipant.joinedAt).getTime()
          : examStartMs;
        const sessionStart = new Date(Math.max(examStartMs, joinedMs));
        await ExamModel.updateOne(
          {
            _id: exam._id,
            participants: {
              $elemMatch: {
                user: userId,
                $and: [
                  {
                    $or: [
                      { submittedAt: { $exists: false } },
                      { submittedAt: null },
                    ],
                  },
                  {
                    $or: [
                      { startedAt: { $exists: false } },
                      { startedAt: null },
                    ],
                  },
                ],
              },
            },
          },
          { $set: { "participants.$.startedAt": sessionStart } },
        );
        myParticipant.startedAt = sessionStart;
      }
    }

    // Hide unpublished upcoming exams from non-participants.
    // Do NOT 404 live exams solely on isActive — list endpoints can surface LIVE
    // exams while isActive is still stale. ENDED details are needed so lobby/take
    // can redirect participants to results, but only for people who joined.
    if (!isParticipant) {
      if (!exam.isActive && effective === "UPCOMING") {
        return res.status(404).json({ message: "Exam not found or not active" });
      }
      if (effective === "ENDED") {
        return res.status(404).json({ message: "Exam not found or not active" });
      }
    }

    // Sanitize — strip answer keys per quiz type
    const safeExam = exam.toObject();
    safeExam.status = effective;
    safeExam.chapters = safeExam.chapters.map((chapter) => ({
      ...chapter,
      quizIds: (chapter.quizIds || []).map((quiz) =>
        quiz && typeof quiz === "object" ? sanitizeQuizForUser(quiz) : quiz
      ),
    }));

    // Keep lobby participant list lean: never send other students' answers.
    // Only the current user needs their own answers (TakeExam resume).
    safeExam.participants = (safeExam.participants || []).map((p) => {
      const pId = p.user?._id ? p.user._id.toString() : p.user?.toString?.();
      const isMe = pId === userId.toString();
      return {
        user: p.user,
        joinedAt: p.joinedAt,
        startedAt: p.startedAt ?? null,
        submittedAt: p.submittedAt ?? null,
        ...(isMe
          ? {
              score: p.score,
              timeSpent: p.timeSpent,
              answers: p.answers ?? [],
            }
          : {}),
      };
    });

    res.status(200).json(safeExam);
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

    const exam = await ExamModel.findById(id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // ── Stale-status correction (competition pattern) ──────────────────────
    const now   = new Date();
    const start = new Date(exam.startTime);
    const end   = new Date(exam.endTime);

    // Block join only if the exam has already ended
    if (now > end) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    // Correct stale status flags in-memory — only relevant when exam is LIVE
    if (now >= start && now <= end && (exam.status !== "LIVE" || !exam.isActive)) {
      exam.status   = "LIVE";
      exam.isActive = true;
    }

    // Guard: access code
    if (exam.accessCode && exam.accessCode !== accessCode) {
      return res.status(403).json({ message: "Invalid access code", requireCode: true });
    }

    // ── ATOMIC CONCURRENCY FIX for "already joined" + "exam is full" ─────────
    // The old pattern read exam.participants as a snapshot, checked the guards,
    // then wrote in a separate operation. Under concurrent joins (e.g. 100 users
    // hitting the endpoint simultaneously) all requests could pass both guards
    // using their individual stale snapshots and the same user could be added
    // twice, or maxParticipants could be exceeded.
    //
    // Solution: push the guards INTO the MongoDB query filter so the check and
    // the write happen in a single atomic findOneAndUpdate. MongoDB will only
    // update the document when ALL filter conditions are satisfied, which is
    // evaluated atomically under its document-level lock.
    //
    //  • "participants.user": { $ne: userId }       → reject if already joined
    //  • $expr $lt [$size, maxParticipants]         → reject if at capacity
    //  • $set status/isActive                       → correct stale status
    const joinFilter = {
      _id: id,
      "participants.user": { $ne: userId },   // atomic "not already joined" guard
    };

    // Only add the capacity guard when maxParticipants is configured
    if (exam.maxParticipants) {
      joinFilter.$expr = { $lt: [{ $size: "$participants" }, exam.maxParticipants] };
    }

    const joined = await ExamModel.findOneAndUpdate(
      joinFilter,
      {
        $push: { participants: { user: userId, joinedAt: new Date() } },
        // Only correct status to LIVE if exam has actually started
        ...(now >= start && now <= end
          ? { $set: { status: "LIVE", isActive: true } }
          : {}),
      },
      { new: true, select: "participants.user maxParticipants" }
    );

    // If no document was matched the user is either already in or the exam is full.
    // Re-check which case it is so we can return the right error message.
    if (!joined) {
      const current = await ExamModel.findById(id)
        .select("participants.user maxParticipants")
        .lean();
      const alreadyIn = current?.participants?.some(
        p => p.user.toString() === userId.toString()
      );
      if (alreadyIn) {
        return res.status(400).json({ message: "Already joined this exam" });
      }
      return res.status(400).json({ message: "Exam is full" });
    }

    // ── Broadcast to all lobby members so they see the new participant ────────
    // Fetch the user's public profile for the broadcast payload.
    // Fire-and-forget — don't block the HTTP response on this.
    (async () => {
      try {
        const { default: UserModel } = await import("../models/UserSchema.js");
        const userDoc = await UserModel.findById(userId)
          .select("name username avatar")
          .lean();
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
      } catch (err) {
        console.error("[joinExam] socket broadcast error:", err);
      }
    })();

    // Ensure the exam-end timer is running (handles the case where admin
    // activates an exam but the server restarted before recovery ran).
    scheduleExamEnd(id, exam.endTime);

    res.status(200).json({
      message:          "Joined exam successfully",
      participantCount: joined.participants.length,
    });
  } catch (error) {
    console.error("Error joining exam:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};


// ─── Save / Update a Single Answer (accumulates active time per question) ─────
/**
 * Called every time a student answers OR changes an answer for a question.
 *
 * How time works (mirrors competition puzzle-solve pattern):
 *  - The FRONTEND measures how many seconds the student was actively working
 *    on a question (focus timer, not wall-clock).
 *  - On each answer save (initial or revision), the frontend sends `timeSpent`
 *    for THAT interaction only (the delta, not the total).
 *  - The backend ADDS it to the existing `questionTimeSpent` for that question,
 *    and also adds it to the participant's running `timeSpent` total.
 *  - This way: idle time, time spent on other questions, and away-from-tab
 *    time are all excluded from the final timeSpent figure.
 *
 * Request body:
 *   { quizId, timeSpent, selectedOption?, textAnswer?, matchedPairs?,
 *     sequenceAnswer?, boardMove?, pieceValueAnswer?, pieceCombinationAnswer? }
 */
export const saveAnswer = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user._id;
    const {
      quizId,
      timeSpent: rawTimeSpent,
      selectedOption,
      textAnswer,
      matchedPairs,
      sequenceAnswer,
      boardMove,
      pieceValueAnswer,
      pieceCombinationAnswer,
      boardBuilderAnswer,
    } = req.body;

    if (!quizId) {
      return res.status(400).json({ message: "quizId is required" });
    }

    // Normalize time — same as normalizePuzzleTimeSpent in competition utils:
    // must be a positive finite number; default to 0 if missing/invalid.
    const seconds = Number(rawTimeSpent);
    const timeIncrement = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    
    // console.log("[saveAnswer] Time tracking:", { 
    //   quizId, 
    //   rawTimeSpent, 
    //   seconds, 
    //   timeIncrement,
    //   userId: userId.toString()
    // });

    // ── Fetch only what we need ──────────────────────────────────────────────
    const exam = await ExamModel.findById(id)
      .select("status endTime participants")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });
    if (new Date() > new Date(exam.endTime)) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    const participant = exam.participants.find(
      p => p.user.toString() === userId.toString()
    );
    if (!participant) {
      return res.status(403).json({ message: "You have not joined this exam" });
    }
    if (participant.submittedAt) {
      return res.status(400).json({ message: "Exam already submitted" });
    }

    // ── Build the answer payload ──────────────────────────────────────────────
    const answerFields = {
      "participants.$.answers.$[ans].selectedOption":         selectedOption         ?? null,
      "participants.$.answers.$[ans].textAnswer":             textAnswer             ?? null,
      "participants.$.answers.$[ans].matchedPairs":           matchedPairs           ?? [],
      "participants.$.answers.$[ans].sequenceAnswer":         sequenceAnswer         ?? [],
      "participants.$.answers.$[ans].boardMove":              boardMove              ?? null,
      "participants.$.answers.$[ans].pieceValueAnswer":       pieceValueAnswer       ?? [],
      "participants.$.answers.$[ans].pieceCombinationAnswer": pieceCombinationAnswer ?? [],
      "participants.$.answers.$[ans].boardBuilderAnswer":     boardBuilderAnswer     ?? null,
    };

    // Check whether this question already has an answer saved
    const existingAnswer = participant.answers?.find(
      a => a.quizId?.toString() === quizId.toString()
    );

    if (existingAnswer) {
      // ── UPDATE existing answer + add time increment ───────────────────────
      // The frontend sends only the additional time spent on this revision, not
      // a cumulative total. We $inc both the question-level and participant-level
      // counters atomically.
      await ExamModel.updateOne(
        {
          _id: id,
          "participants.user": userId,
          "participants.answers.quizId": quizId
        },
        {
          $inc: {
            "participants.$.timeSpent":                      timeIncrement,
            "participants.$.answers.$[ans].questionTimeSpent": timeIncrement
          },
          $set: answerFields
        },
        {
          arrayFilters: [{ "ans.quizId": new (await import("mongoose")).default.Types.ObjectId(quizId) }]
        }
      );
    } else {
      // ── INSERT new answer entry ───────────────────────────────────────────
      // $push the answer + $inc the participant-level timeSpent in one operation.
      await ExamModel.updateOne(
        { _id: id, "participants.user": userId },
        {
          $inc: { "participants.$.timeSpent": timeIncrement },
          $push: {
            "participants.$.answers": {
              quizId,
              questionTimeSpent:      timeIncrement,
              selectedOption:         selectedOption         ?? null,
              textAnswer:             textAnswer             ?? null,
              matchedPairs:           matchedPairs           ?? [],
              sequenceAnswer:         sequenceAnswer         ?? [],
              boardMove:              boardMove              ?? null,
              pieceValueAnswer:       pieceValueAnswer       ?? [],
              pieceCombinationAnswer: pieceCombinationAnswer ?? [],
              boardBuilderAnswer:     boardBuilderAnswer     ?? null,
            }
          }
        }
      );
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

    // ── Step 1: Load exam content (quizzes) for scoring ──────────────────────
    const exam = await ExamModel.findById(id).populate("chapters.quizIds");
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // Allow submission up to 60 seconds after endTime to handle auto-submit race
    // conditions (the frontend timer fires at t=0 but the request may arrive
    // slightly after endTime).
    const gracePeriodMs = 60 * 1000;
    const submissionTime = new Date();
    if (new Date() > new Date(new Date(exam.endTime).getTime() + gracePeriodMs)) {
      return res.status(400).json({ message: "Exam has ended" });
    }

    const participant = exam.participants.find(
      p => p.user.toString() === userId.toString()
    );
    if (!participant) {
      return res.status(400).json({ message: "You have not joined this exam" });
    }

    // Wall-clock time from exam session start → submission (manual or auto).
    const totalActiveTimeSpent = computeWallClockTimeSpent(
      participant,
      exam,
      submissionTime,
    );
    // (Do this BEFORE the atomic write so we never block the DB operation on
    // the scoring CPU work, and so we have the values ready for the $set.)
   // console.log("[submitExam] Participant answers before scoring:", participant.answers);
    
    // Use submitted answers from request body if available, otherwise use accumulated answers
    const answersToScore = submittedAnswers && submittedAnswers.length > 0 
      ? submittedAnswers 
      : participant.answers ?? [];
      
    //console.log("[submitExam] Answers to score:", answersToScore);
    
    const quizDocsMap = buildQuizMap(exam);
    const { processedAnswers, score, totalQuestions, correctCount } =
      scoreExam(quizDocsMap, answersToScore);
    const totalMaxMarks = computeTotalMaxMarks(exam, totalQuestions);

    // ── Step 3: Atomic compare-and-set — the ONLY place submittedAt is written ─
    //
    // OLD pattern (race condition):
    //   1. Read participant → check submittedAt        ← snapshot A
    //   2. (gap) concurrent request also reads, also sees submittedAt = null
    //   3. Write submittedAt                           ← both requests write
    //
    // NEW pattern: the filter includes "participants.submittedAt does not exist OR is null".
    // MongoDB evaluates this filter and the $set in a single atomic operation
    // under its document-level lock. If submittedAt is already set (by a
    // concurrent request that won the race) this findOneAndUpdate returns null
    // and we respond 400 without writing again.
    // Note: $exists: false doesn't match null values, so we need $or to check both
    const submitFilter = {
      _id: id,
      "participants.user": userId,
      $or: [
        { "participants.submittedAt": { $exists: false } },
        { "participants.submittedAt": null }
      ]
    };

   // console.log("[submitExam] Update filter:", submitFilter);

    // Perform atomic update without returning the document
const updateResult = await ExamModel.updateOne(
  submitFilter,
  {
    $set: {
      "participants.$.score": score,
      "participants.$.answers": processedAnswers,
      "participants.$.submittedAt": submissionTime,
      "participants.$.timeSpent": totalActiveTimeSpent,
    },
  }
);

//console.log("[submitExam] Update result:", { matchedCount: updateResult.matchedCount, modifiedCount: updateResult.modifiedCount });

// If no document matched, the user has already submitted
if (updateResult.matchedCount === 0) {
 // console.log("[submitExam] No match found - user already submitted or filter mismatch");
  // Still broadcast the submission status so the frontend updates correctly
  // even for duplicate submission attempts
  const existingParticipant = await ExamModel.findOne(
    { _id: id, "participants.user": userId },
    { "participants.$": 1 }
  );
  const existingSubmittedAt = existingParticipant?.participants?.[0]?.submittedAt;
  console.log("[submitExam] Existing participant check:", { existingParticipant, existingSubmittedAt });
  if (existingSubmittedAt) {
    const existingRecord = existingParticipant?.participants?.[0];
    broadcastParticipantSubmitted(id, userId, {
      submittedAt: existingSubmittedAt,
      score: existingRecord?.score ?? 0,
      timeSpent: resolveParticipantTimeSpent(existingRecord || {}, exam),
      correctCount: (existingRecord?.answers ?? []).filter((a) => a.isCorrect).length,
      status: "Submitted",
    }).catch((err) => {
      console.error("[submitExam] socket broadcast error (duplicate):", err);
    });
  }
  return res.status(400).json({ message: "You have already submitted this exam" });
}

// Fetch the updated exam with the specific participant
const submitted = await ExamModel.findOne(
  { _id: id, "participants.user": userId },
  { "participants.$": 1, resultsPublished: 1 }
);

// If no document matched, the user has already submitted (concurrent request
// won the race, or user double-tapped submit). This should rarely happen
// since the atomic updateOne already guards against it.
if (!submitted) {
  return res.status(400).json({ message: "You have already submitted this exam" });
}

    // ── Step 4: Auto-publish results once ALL participants have submitted ──────
    // Fire-and-forget — don't block the response on this secondary check.
    if (!exam.resultsPublished) {
      ExamModel.findById(id)
        .select("participants.submittedAt resultsPublished")
        .lean()
        .then(updatedExam => {
          const allSubmitted =
            updatedExam?.participants?.length > 0 &&
            updatedExam.participants.every(p => !!p.submittedAt);
          if (allSubmitted) {
            ExamModel.updateOne(
              { _id: id },
              { $set: { resultsPublished: true } }
            ).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // ── Step 5: Broadcast submission event to everyone in the exam room ───────
    console.log("[submitExam] Broadcasting submission:", {
      examId: id,
      userId: userId.toString(),
      submissionTime,
    });
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
      totalQuestions,
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
    // Leaderboard tab only needs scores + participant list — skip heavy quiz populate.
    const view = String(req.query.view || "").toLowerCase();
    const leaderboardOnly = view === "leaderboard";

    let examQuery = ExamModel.findById(id)
      .populate("participants.user", "name username avatar profilePicture");

    if (!leaderboardOnly) {
      examQuery = examQuery.populate("chapters.quizIds");
    }

    const exam = await examQuery.lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    // Derive effective status from wall-clock — same pattern as getExamDetailsForUser.
    // If the exam has ended, treat resultsPublished as true regardless of DB value
    // (the DB update is fire-and-forget and may not have landed yet on the first call).
    const effectiveExamStatus = effectiveStatus(exam);
    if (effectiveExamStatus === "ENDED" && !exam.resultsPublished) {
      exam.resultsPublished = true;
      ExamModel.updateOne({ _id: exam._id }, { $set: { resultsPublished: true, status: "ENDED", isActive: false } }).catch(() => {});
    }

    const participant = exam.participants.find(p => {
      const pId = p.user?._id ? p.user._id.toString() : p.user.toString();
      return pId === userId.toString();
    });

    if (!participant) {
      return res.status(404).json({ message: "You have not participated in this exam" });
    }

    // Allow access if the user has already submitted (they can see their own results
    // even while waiting for others to finish). Full leaderboard only shows once
    // resultsPublished is true (i.e. all participants have submitted or exam ended).
    if (!exam.resultsPublished && !participant.submittedAt) {
      return res.status(403).json({ message: "Results have not been published yet" });
    }

    // Count total questions across all chapters (ObjectIds are enough — no populate needed)
    const totalQuestions = (exam.chapters || []).reduce(
      (sum, ch) => sum + (ch.quizIds?.length ?? 0), 0
    );
    const correctCount = (participant.answers ?? []).filter(a => a.isCorrect).length;
    const totalMaxMarks = computeTotalMaxMarks(exam, totalQuestions);
    const participantScore = participant.submittedAt
      ? (participant.score ?? correctCount * EXAM_MARKS_PER_QUESTION)
      : (participant.score ?? 0);

    // Build examDetails with ALL participants (including 0-score / non-submitted)
    // so the frontend leaderboard can show every registrant.
    const examDetails = {
      _id:              exam._id,
      name:             exam.name,
      title:            exam.name,
      description:      exam.description,
      startTime:        exam.startTime,
      endTime:          exam.endTime,
      duration:         exam.duration,
      status:           effectiveStatus(exam),
      resultsPublished: exam.resultsPublished,
      // Full quiz docs only for analysis; leaderboard keeps chapter names/counts.
      chapters: leaderboardOnly
        ? (exam.chapters || []).map((ch) => ({
            name: ch.name,
            title: ch.title,
            quizIds: Array.isArray(ch.quizIds) ? ch.quizIds.map((q) => q?._id || q) : [],
          }))
        : exam.chapters,
      participants: exam.participants.map(p => {
        // Recompute correctCount from stored answers (source of truth).
        // This ensures the leaderboard is always consistent even if the
        // stored score field is stale from an earlier session.
        const pCorrectCount = (p.answers ?? []).filter(a => a.isCorrect).length;
        const pScore = p.submittedAt
          ? (p.score ?? pCorrectCount * EXAM_MARKS_PER_QUESTION)
          : (p.score ?? 0);

        const pTimeSpent = resolveParticipantTimeSpent(p, exam);

        return {
          user:         p.user,
          score:        pScore,
          correctCount: pCorrectCount,
          timeSpent:    pTimeSpent,
          joinedAt:     p.joinedAt,
          startedAt:    p.startedAt ?? null,
          submittedAt:  p.submittedAt ?? null,
          status:       p.submittedAt ? "Submitted" : "Joined",
        };
      }),
    };

    const participantTimeSpent = resolveParticipantTimeSpent(participant, exam);

    res.status(200).json({
      score:          participantScore,
      totalMaxMarks,
      timeSpent:      participantTimeSpent,
      totalQuestions,
      correctCount,
      // Answer breakdown + full quizzes only needed for Analyze tab
      answers:        leaderboardOnly ? [] : (participant.answers ?? []),
      examDetails,
      view:           leaderboardOnly ? "leaderboard" : "full",
    });
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─── Get Exam Leaderboard (student) ──────────────────────────────────────────
export const getExamLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;

    // Only load the fields we need — don't pull quiz documents for a leaderboard
    const exam = await ExamModel.findById(id)
      .populate("participants.user", "name username avatar")
      .select("resultsPublished participants name status")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    if (!exam.resultsPublished) {
      return res.status(403).json({ message: "Results have not been published yet" });
    }

    const leaderboard = buildLeaderboard(exam.participants);

    res.status(200).json({
      leaderboard,
      totalParticipants: exam.participants.length
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ─── Get Exam Leaderboard (admin — no resultsPublished gate) ─────────────────
export const getAdminExamLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;

    const exam = await ExamModel.findById(id)
      .populate("participants.user", "name username avatar email")
      .select("participants name status resultsPublished")
      .lean();

    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const leaderboard = buildLeaderboard(exam.participants);

    res.status(200).json({
      leaderboard,
      totalParticipants:  exam.participants.length,
      resultsPublished:   exam.resultsPublished
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

