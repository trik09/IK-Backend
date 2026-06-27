import CompetitionModel from "../models/CompetitionSchema.js";
import ParticipantModel from "../models/ParticipantSchema.js";
import PuzzleSolutionModel from "../models/PuzzleSolutionSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import UserModel from "../models/UserSchema.js";
import { io } from "../index.js";
import redis from "../config/redis.js";
import EventRoundModel from "../models/EventRoundSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import { recordPuzzleAttempt } from "../utils/puzzleRating.js";

import { scheduleCompetitionEnd, getCurrentLeaderboard, handleCompetitionEnd,upsertLeaderboardEntry, addParticipantToLeaderboard, getIO, leaderboardKey, leaderboardMetaKey, redisScore } from "../utils/socketHandlers.js";
import {
  buildIdempotentAttemptResponse,
  upsertTerminalAttempt,
  savePuzzleSolutionSafe,
  calcTotalSolveTime,
  normalizePuzzleTimeSpent,
} from "../utils/puzzleAttemptUtils.js";
import { validatePuzzleSolution } from "../utils/puzzleValidationUtils.js";

// Helper: check event round access & qualifications
export const checkEventRoundAccess = async (competitionId, userId) => {
  const eventRound = await EventRoundModel.findOne({ competitionId }).select("eventId order").lean();
  if (!eventRound) {
    return { allowed: true };
  }

  // 1. Check if user is registered and approved for the overall Event
  const eventParticipant = await EventParticipantModel.findOne({
    eventId: eventRound.eventId,
    userId,
    isApproved: true
  }).lean();

  if (!eventParticipant) {
    return {
      allowed: false,
      message: "This tournament is restricted. You must register and get approved for the corresponding event first."
    };
  }

  // 2. Round 1 (order 0) is default open to all approved event participants
  if (eventRound.order === 0) {
    return { allowed: true };
  }

  // 3. For Round N > 1, check admin selection/advancement qualification
  const targetRound = await EventRoundModel.findOne({ competitionId })
    .select("allowAll isSelectionFinalized selectedUserIds")
    .lean();

  if (!targetRound) return { allowed: true };

  if (!targetRound.isSelectionFinalized) {
    return {
      allowed: false,
      message: "Selection for this round is in progress. Please wait for the admin to finalize the qualified players."
    };
  }

  if (targetRound.allowAll) {
    return { allowed: true };
  }

  const isSelected = targetRound.selectedUserIds?.some(
    (id) => id.toString() === userId.toString()
  );

  if (!isSelected) {
    return {
      allowed: false,
      message: "You did not qualify for this round of the event. Thank you for participating!"
    };
  }

  return { allowed: true };
};

// Participate in live competition (REST API validation)
export const participateInCompetition = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const { username, accessCode } = req.body;
    const userId = req.user._id;

    // Fetch competition with minimal fields
    const competition = await CompetitionModel.findById(competitionId)
      .select(
        "name description startTime endTime duration status accessCode maxParticipants puzzles chapters"
      )
      .lean();

    if (!competition) {
      return res.status(404).json({
        success: false,
        error: "Competition not found",
      });
    }

    // Check event round qualifications & access code
    const accessCheck = await checkEventRoundAccess(competitionId, userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: accessCheck.message
      });
    }

    const now = new Date();

    if (competition.status === "ENDED" || now > competition.endTime) {
      return res.status(400).json({
        success: false,
        error: "Competition has ended",
      });
    }

    // Access code validation
    if (competition.accessCode && competition.accessCode.trim() !== "") {
      if (!accessCode || accessCode.trim() !== competition.accessCode.trim()) {
        return res.status(403).json({
          success: false,
          error: "Invalid access code",
          requireCode: true,
        });
      }
    }

    // Run queries in parallel
    const [participantCount, existingParticipant] = await Promise.all([
      ParticipantModel.countDocuments({ competitionId }),
      ParticipantModel.findOne({ competitionId, userId }).lean(),
    ]);

    // Max participant validation
    if (
      competition.maxParticipants &&
      participantCount >= competition.maxParticipants
    ) {
      return res.status(400).json({
        success: false,
        error: "Competition is full",
      });
    }

    // If already participating
    if (existingParticipant) {
      if (existingParticipant.isBlocked) {
        return res.status(403).json({
          success: false,
          error: "You have been blocked from this competition by the admin.",
        });
      }
      if (existingParticipant.submittedAt) {
        return res.status(400).json({
          success: false,
          message: "You have already submitted this competition",
        });
      }

      return res.json({
        success: true,
        message: "Already participating",
        competition: {
          id: competition._id,
          name: competition.name,
          description: competition.description,
          startTime: competition.startTime,
          endTime: competition.endTime,
          duration: competition.duration,
          status: competition.status,
          participantCount,
        },
      });
    }

    // Create participant
    const participant = await ParticipantModel.create({
      competitionId,
      userId,
      username: username || req.user.username || req.user.name,
      status: "JOINED",
      joinedAt: new Date(),
      score: 0,
      puzzlesSolved: 0,
      timeSpent: 0,
    });

    // Unified system: Sync back to legacy Competition.participants array
    try {
      await CompetitionModel.findByIdAndUpdate(competitionId, {
        $push: {
          participants: {
            user: userId,
            score: 0,
            joinedAt: new Date(),
          }
        }
      });
    } catch (err) {
      console.error("Legacy participant sync error:", err);
    }

    // Send response immediately
    res.json({
      success: true,
      competition: {
        id: competition._id,
        name: competition.name,
        description: competition.description,
        startTime: competition.startTime,
        endTime: competition.endTime,
        duration: competition.duration,
        puzzles: competition.puzzles,
        chapters: competition.chapters || [],
        maxScore: (competition.puzzles?.length || 0) * 10,
        status: competition.status,
        participantCount: participantCount + 1,
      },
    });

    // Run Redis + Socket operations in background
    setImmediate(async () => {
      try {
        // Always keep Redis leaderboard in sync so lobby views
        // (which may read from Redis cache) see ALL participants,
        // even while the competition is still UPCOMING.
        await addParticipantToLeaderboard(competition._id, participant);

        const roomName = `competition_${competitionId}`;

        io.to(roomName).emit("participantJoined", {
          username: participant.username,
          userId: participant.userId.toString(),
        });

        // Broadcast latest leaderboard to everyone in the room.
        // Note: addParticipantToLeaderboard already emits a
        // "leaderboardUpdate" event after syncing Redis, so this
        // extra emit is mainly a safety net and can be removed
        // later if desired.
        const leaderboard = await getCurrentLeaderboard(competitionId);
        io.to(roomName).emit("leaderboardUpdate", leaderboard);
      } catch (err) {
        console.error("Background event error:", err);
      }
    });
  } catch (error) {
    console.error("Participation error:", error);

    res.status(500).json({
      success: false,
      error: "Server error during participation",
    });
  }
};


export const submitCompetition = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const userId = req.user._id;

    // ── Validate competition ──────────────────────────────────────────────────
    const competition = await CompetitionModel.findById(competitionId);
    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found",
      });
    }

    if (
      competition.status !== "live" &&
      competition.status !== "LIVE"
    ) {
      return res.status(400).json({
        success: false,
        message: "Competition is not currently active",
      });
    }

    // ── Validate participant ──────────────────────────────────────────────────
    const participant = await ParticipantModel.findOne({
      competitionId,
      userId,
    });

    if (!participant || participant.isBlocked) {
      return res.status(403).json({
        success: false,
        message: participant?.isBlocked
          ? "You have been blocked from this competition by the admin."
          : "You are not participating in this competition",
      });
    }

    // ── Validate all puzzles are attempted ────────────────────────────────────
    // Deduplicate puzzle IDs first.
    const uniquePuzzleIds = [
      ...new Set((competition.puzzles || []).map((id) => id.toString()))
    ];

    // Filter out ghost IDs — puzzles that were deleted from the Puzzle collection
    // after the competition was created. populate() returns null for these, so the
    // frontend never shows them. Using the raw array length as totalPuzzles would
    // permanently block users since they can never attempt a non-existent puzzle.
    const existingPuzzleDocs = await PuzzleModel.find(
      { _id: { $in: uniquePuzzleIds } },
      { _id: 1 }
    ).lean();
    const existingPuzzleIdSet = new Set(existingPuzzleDocs.map(p => p._id.toString()));
    const validPuzzleIds = uniquePuzzleIds.filter(id => existingPuzzleIdSet.has(id));

    const totalPuzzles = validPuzzleIds.length;

    // Match attempts against only the valid (non-deleted) puzzle IDs.
    const attemptedDocs = await PuzzleAttemptModel.find({
      competitionId,
      userId,
      puzzleId: { $in: validPuzzleIds },
    }).select('puzzleId').lean();

    const attemptedPuzzleIds = new Set(attemptedDocs.map(a => a.puzzleId.toString()));
    const unattemptedIds = validPuzzleIds.filter(id => !attemptedPuzzleIds.has(id));

    if (unattemptedIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Please attempt all puzzles before submitting. ${unattemptedIds.length} puzzle${unattemptedIds.length > 1 ? 's' : ''} remaining.`,
        unattempted: unattemptedIds.length,
        total: totalPuzzles,
        attempted: attemptedPuzzleIds.size,
      });
    }

    // ── Mark as submitted ─────────────────────────────────────────────────────
    const submittedAt = new Date();
    participant.submittedAt = submittedAt;
    participant.isActive    = false;
    participant.isSubmitted = true;
    participant.status      = "SUBMITTED";

    participant.timeSpent = Math.max(
      participant.timeSpent || 0,
      await calcTotalSolveTime(competitionId, userId)
    );

    await participant.save();

    // ── ✅ Sync Redis with safe upsert (no more JSON-string duplicates) ───────
    try {
      await upsertLeaderboardEntry(competitionId, {
        userId       : participant.userId.toString(),
        username     : participant.username,
        score        : participant.score        || 0,
        puzzlesSolved: participant.puzzlesSolved || 0,
        timeSpent    : participant.timeSpent     || 0,
        status       : "SUBMITTED",
        submittedAt  : participant.submittedAt,
      });
    } catch (redisError) {
      console.error(
        "[Leaderboard] Redis upsert error in submitCompetition:",
        redisError
      );
    }

    // ── Broadcast updated leaderboard ─────────────────────────────────────────
    const roomName = `competition_${competitionId}`;

    getCurrentLeaderboard(competitionId)
      .then((updatedLeaderboard) => {
        io.to(roomName).emit("leaderboardUpdate", updatedLeaderboard);
      })
      .catch((err) =>
        console.error("[Leaderboard] Submit leaderboard broadcast error:", err)
      );

    io.to(roomName).emit("participantSubmitted", {
      username     : participant.username,
      score        : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
    });

    // ── Check if ALL participants have submitted ───────────────────────────────
    const totalParticipants = await ParticipantModel.countDocuments({
      competitionId,
    });
    const submittedParticipants = await ParticipantModel.countDocuments({
      competitionId,
      $or: [
        { isSubmitted: true },
        { submittedAt: { $exists: true } },
      ],
    });

    // Send response first, then optionally end competition
    res.json({
      success      : true,
      message      : "Competition submitted successfully",
      finalScore   : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
    });

    // End competition early if everyone has submitted
    if (totalParticipants > 0 && submittedParticipants >= totalParticipants) {
      console.log("All participants submitted. Ending competition early.");
      setTimeout(() => {
        handleCompetitionEnd(io, competitionId);
      }, 100);
    }
  } catch (error) {
    console.error("[Controller] Competition submission error:", error);
    res.status(500).json({
      success: false,
      error  : "Server error during submission",
    });
  }
};

/* =========================================================
   SUBMIT PUZZLE SOLUTION
========================================================= */
export const submitPuzzleSolution = async (req, res) => {
  try {
    const { competitionId, puzzleId } = req.params;
    const { solution, timeSpent: rawTimeSpent, boardPosition, moveHistory, moveCount } = req.body;
    const timeSpent = normalizePuzzleTimeSpent(rawTimeSpent);
    const userId = req.user._id;

    /* ── Competition check ───────────────────────────────────────────────── */
    const competition = await CompetitionModel.findById(competitionId);
    if (!competition || new Date() > competition.endTime) {
      return res.status(400).json({
        success: false,
        message: "Competition has ended",
      });
    }

    const now        = new Date();
    const isTimeLive =
      now >= competition.startTime && now <= competition.endTime;

    if (competition.status !== "LIVE" && !isTimeLive) {
      return res.status(400).json({
        success: false,
        message: "Competition is not live",
      });
    }

    // Fix stale DB status asynchronously
    if (competition.status !== "LIVE" && isTimeLive) {
      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: "LIVE", isActive: true }
      ).catch(() => {});
    }

    /* ── Participant check ───────────────────────────────────────────────── */
    const participant = await ParticipantModel.findOne({
      competitionId,
      userId,
    });

    if (!participant || participant.isBlocked) {
      return res.status(403).json({
        success: false,
        message: participant?.isBlocked
          ? "You have been blocked from this competition by the admin."
          : "You are not participating in this competition",
      });
    }

    if (participant.status === "SUBMITTED") {
      return res.status(400).json({
        success: false,
        message: "You have already submitted the competition",
      });
    }

    /* ── Duplicate attempt check (idempotent — return 200, not 400) ─────── */
    const existingAttempt = await PuzzleAttemptModel.findOne({
      competitionId,
      puzzleId,
      userId,
    });

    if (
      existingAttempt &&
      (existingAttempt.status === "solved" ||
        existingAttempt.status === "failed")
    ) {
      const freshParticipant = await ParticipantModel.findOne({
        competitionId,
        userId,
      });
      return res.json(
        buildIdempotentAttemptResponse(existingAttempt, freshParticipant)
      );
    }

    /* ── Puzzle check ────────────────────────────────────────────────────── */
    const puzzle = await PuzzleModel.findById(puzzleId);
    if (!puzzle) {
      return res.status(404).json({
        success: false,
        message: "Puzzle not found",
      });
    }

    const { isCorrect, scoreOverride } = validatePuzzleSolution(
      puzzle,
      solution,
      moveCount,
      moveHistory
    );

    /* ── Mark player as PLAYING on first solve attempt ───────────────────── */
    if (participant.status === "JOINED") {
      participant.status = "PLAYING";
      await participant.save();

      io.to(`competition_${competitionId}`).emit("player-progress", {
        userId,
        participantState: "PLAYING",
      });
    }

    /* ── Per-puzzle solve time is accumulated on each attempt ───────────── */
    const puzzleTimeIncrement = timeSpent;

    /* ═══════════════════════════════════════════════════════════════════════
       CORRECT SOLUTION
    ═══════════════════════════════════════════════════════════════════════ */
    if (isCorrect) {
      // scoreOverride is set for capture puzzles with partial scoring (half marks = 5)
      const scoreEarned = scoreOverride !== null ? scoreOverride : calculateScore(puzzle.difficulty, timeSpent);

      // Build a human-readable message for capture partial scoring
      let solveMessage = "Puzzle solved successfully!";
      if (puzzle.type === 'capture' && scoreOverride !== null) {
        const moveLimit = parseInt(puzzle.captureConfig?.maximumNoOfMoves) || 0;
        solveMessage = `Captured after exceeding the ${moveLimit}-move limit. Half marks awarded.`;
      } else if (puzzle.type === 'capture') {
        const moveLimit = parseInt(puzzle.captureConfig?.maximumNoOfMoves) || 0;
        if (moveLimit > 0) solveMessage = `Captured within the ${moveLimit}-move limit. Full marks awarded!`;
      }

      // Atomically save attempt — skip score if another request won the race
      const attemptDoc = await upsertTerminalAttempt(
        { competitionId, puzzleId, userId },
        {
          status      : "solved",
          solution,
          boardPosition,
          moveHistory : moveHistory || [],
          timeSpent,
          scoreEarned,
          isLocked    : true,
          completedAt : new Date(),
        }
      );

      if (attemptDoc) {
        if (competition.isRated !== false) {
          await recordPuzzleAttempt(userId, puzzleId, true).catch(err => console.error("[Rating] solved attempt error:", err));
        }
      } else {
        const settled = await PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId });
        const currentParticipant = await ParticipantModel.findOne({ competitionId, userId });
        return res.json(buildIdempotentAttemptResponse(settled, currentParticipant));
      }

      // Backward-compat solution record (ignore duplicate-key races)
      await savePuzzleSolutionSafe(PuzzleSolutionModel, {
        competitionId,
        puzzleId,
        userId,
        solution,
        timeSpent,
        scoreEarned,
        isCorrect: true,
        solvedAt : new Date(),
      });

      // Update participant score in DB, then sync aggregate solve time
      await ParticipantModel.findOneAndUpdate(
        { competitionId, userId },
        {
          $inc: {
            score: scoreEarned,
            puzzlesSolved: 1,
            timeSpent: puzzleTimeIncrement,
          },
          $set: { lastActivity: new Date() },
        }
      );
      const updatedParticipant = await ParticipantModel.findOne({
        competitionId,
        userId,
      });

      // ── ✅ Sync Redis with safe upsert ──────────────────────────────────
      try {
        await upsertLeaderboardEntry(competitionId, {
          userId       : updatedParticipant.userId.toString(),
          username     : updatedParticipant.username,
          score        : updatedParticipant.score        || 0,
          puzzlesSolved: updatedParticipant.puzzlesSolved || 0,
          timeSpent    : updatedParticipant.timeSpent     || 0,
          status       : updatedParticipant.status        || "PLAYING",
          submittedAt  : updatedParticipant.submittedAt   || null,
        });
      } catch (redisError) {
        console.error(
          "[Leaderboard] Redis upsert error in submitPuzzleSolution:",
          redisError
        );
      }

      // ── Broadcast leaderboard + live score update ───────────────────────
      getCurrentLeaderboard(competitionId)
        .then((leaderboard) => {
          io.to(`competition_${competitionId}`).emit(
            "leaderboardUpdate",
            leaderboard
          );
        })
        .catch((err) =>
          console.error("[Leaderboard] Puzzle solve broadcast error:", err)
        );

      io.to(`competition_${competitionId}`).emit("liveScoreUpdate", {
        userId       : updatedParticipant.userId,
        username     : updatedParticipant.username,
        score        : updatedParticipant.score,
        puzzlesSolved: updatedParticipant.puzzlesSolved,
        timeSpent    : updatedParticipant.timeSpent,
        totalSolveTime: updatedParticipant.timeSpent,
        status       : updatedParticipant.status,
      });

      return res.json({
        success      : true,
        isCorrect    : true,
        scoreEarned,
        totalScore   : updatedParticipant.score,
        puzzlesSolved: updatedParticipant.puzzlesSolved,
        puzzleStatus : "solved",
        message      : solveMessage,
        isHalfScore  : scoreOverride !== null,
      });
    }

    /* ═══════════════════════════════════════════════════════════════════════
       INCORRECT SOLUTION
    ═══════════════════════════════════════════════════════════════════════ */
    const failedAttempt = await upsertTerminalAttempt(
      { competitionId, puzzleId, userId },
      {
        status      : "failed",
        solution,
        boardPosition,
        moveHistory : moveHistory || [],
        timeSpent,
        scoreEarned : 0,
        isLocked    : true,
        completedAt : new Date(),
      }
    );

    if (failedAttempt) {
      if (competition.isRated !== false) {
        await recordPuzzleAttempt(userId, puzzleId, false).catch(err => console.error("[Rating] failed attempt error:", err));
      }
    } else {
      const settled = await PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId });
      const currentParticipant = await ParticipantModel.findOne({ competitionId, userId });
      return res.json(buildIdempotentAttemptResponse(settled, currentParticipant));
    }

    // Sync aggregate solve time (no score change)
    const updatedParticipant = await ParticipantModel.findOneAndUpdate(
      { competitionId, userId },
      {
        $inc: { timeSpent: puzzleTimeIncrement },
        $set: { lastActivity: new Date() },
      },
      { new: true }
    );

    // ── ✅ Still upsert Redis so timeSpent stays accurate ───────────────────
    // This also ensures the user is never dropped from the sorted set
    // just because they got a puzzle wrong.
    try {
      await upsertLeaderboardEntry(competitionId, {
        userId       : updatedParticipant.userId.toString(),
        username     : updatedParticipant.username,
        score        : updatedParticipant.score        || 0,
        puzzlesSolved: updatedParticipant.puzzlesSolved || 0,
        timeSpent    : updatedParticipant.timeSpent     || 0,
        status       : updatedParticipant.status        || "PLAYING",
        submittedAt  : updatedParticipant.submittedAt   || null,
      });
    } catch (redisError) {
      console.error(
        "[Leaderboard] Redis upsert error on wrong answer:",
        redisError
      );
    }

    return res.json({
      success      : false,
      isCorrect    : false,
      scoreEarned  : 0,
      totalScore   : updatedParticipant.score,
      puzzlesSolved: updatedParticipant.puzzlesSolved,
      puzzleStatus : "failed",
      message      : "Incorrect solution.",
    });
  } catch (error) {
    console.error("[Controller] Puzzle submission error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during submission",
    });
  }
};


// Get live leaderboard
export const getLiveLeaderboard = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const userId = req.user?._id;

    // Fetch competition with minimal fields
    const competition = await CompetitionModel.findById(competitionId)
      .select("name status startTime endTime")
      .lean();

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found",
      });
    }

    // Run leaderboard + participant queries in parallel
    const [leaderboard, participant] = await Promise.all([
      getCurrentLeaderboard(competitionId),
      userId
        ? ParticipantModel.findOne({ competitionId, userId })
          .select("status")
          .lean()
        : null,
    ]);

    const participantState = participant ? participant.status : "NOT_JOINED";

    res.json({
      success: true,
      competition: {
        id: competition._id,
        name: competition.name,
        status: competition.status,
        startTime: competition.startTime,
        endTime: competition.endTime,
      },
      competitionState: competition.status,
      participantState,
      leaderboard,
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching live leaderboard:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
    });
  }
};

// Get competition puzzles for participants
export const getCompetitionPuzzles = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const userId = req.user._id;

    // Validate competition and participation
    const competition = await CompetitionModel.findById(competitionId).populate('puzzles');
    if (!competition) {
      return res.status(404).json({
        success: false,
        message: 'Competition not found'
      });
    }

    // Validate event round qualifications & access code
    const accessCheck = await checkEventRoundAccess(competitionId, userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: accessCheck.message
      });
    }

    // Fix stale status: if time says LIVE but DB still says UPCOMING, correct it
    const now = new Date();
    const isTimeLive = now >= competition.startTime && now <= competition.endTime;
    if (competition.status === 'UPCOMING' && isTimeLive) {
      competition.status = 'LIVE';
      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: 'LIVE', isActive: true }
      ).catch(() => {});
    }

    // Check if user is a participant
    let participant = await ParticipantModel.findOne({ competitionId, userId });

    if (participant && participant.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'You have been blocked from this competition by the admin.'
      });
    }

    if (!participant) {
      // If they passed checkEventRoundAccess, they are approved for the event.
      // Auto-enroll them!
      const eventRound = await EventRoundModel.findOne({ competitionId }).select("eventId").lean();
      if (eventRound) {
        participant = await ParticipantModel.create({
          competitionId,
          userId,
          username: req.user.username || req.user.name,
          status: "JOINED",
          joinedAt: new Date(),
          score: 0,
          puzzlesSolved: 0,
          timeSpent: 0,
        });

        // Unified system: Sync back to legacy Competition.participants array
        await CompetitionModel.findByIdAndUpdate(competitionId, {
          $push: {
            participants: {
              user: userId,
              score: 0,
              joinedAt: new Date(),
            }
          }
        });

        // Sync to Redis and Broadcast in background
        setImmediate(async () => {
          try {
            await addParticipantToLeaderboard(competitionId, participant);
          } catch (err) {
            console.error("Redis sync error in getCompetitionPuzzles auto-participation:", err);
          }
        });
      } else {
        // Non-event fallback: Wait 600ms and retry once (usual competition path)
        await new Promise(resolve => setTimeout(resolve, 600));
        participant = await ParticipantModel.findOne({ competitionId, userId });
      }
    }

    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'Not a participant in this competition'
      });
    }

    // Get user's puzzle attempts (includes solved, failed, and in-progress)
    const puzzleAttempts = await PuzzleAttemptModel.find({
      competitionId,
      userId
    }).select('puzzleId status scoreEarned timeSpent completedAt boardPosition moveHistory isLocked');

    console.log('Found puzzle attempts for user:', userId, puzzleAttempts.length);
    puzzleAttempts.forEach(attempt => {
      console.log('Attempt:', {
        puzzleId: attempt.puzzleId,
        status: attempt.status,
        isLocked: attempt.isLocked
      });
    });

    // Create attempts map for quick lookup
    const attemptsMap = new Map();
    puzzleAttempts.forEach(attempt => {
      attemptsMap.set(attempt.puzzleId.toString(), {
        status: attempt.status,
        scoreEarned: attempt.scoreEarned || 0,
        timeSpent: attempt.timeSpent || 0,
        completedAt: attempt.completedAt,
        boardPosition: attempt.boardPosition,
        moveHistory: attempt.moveHistory || [],
        isLocked: attempt.isLocked
      });
    });

    // Get user's solved puzzles (for backward compatibility)
    const solvedPuzzles = await PuzzleSolutionModel.find({
      competitionId,
      userId,
      isCorrect: true
    }).select('puzzleId scoreEarned timeSpent solvedAt');

    // Create solved puzzles map for quick lookup
    const solvedMap = new Map();
    solvedPuzzles.forEach(solution => {
      solvedMap.set(solution.puzzleId.toString(), {
        scoreEarned: solution.scoreEarned,
        timeSpent: solution.timeSpent,
        solvedAt: solution.solvedAt
      });
    });

    // Prepare puzzles with solved status and attempt data
    const puzzlesWithStatus = competition.puzzles.map(puzzle => {
      const puzzleId = puzzle._id.toString();
      const attemptData = attemptsMap.get(puzzleId);
      const solvedData = solvedMap.get(puzzleId);

      // Determine puzzle status
      let status = 'unsolved';
      let isSolved = false;
      let isFailed = false;
      let isLocked = false;

      if (attemptData) {
        status = attemptData.status;
        isSolved = attemptData.status === 'solved';
        isFailed = attemptData.status === 'failed';
        isLocked = attemptData.isLocked || isSolved || isFailed;
      } else if (solvedData) {
        // Backward compatibility for old solved puzzles
        status = 'solved';
        isSolved = true;
        isLocked = true;
      }

      return {
        _id: puzzle._id,
        title: puzzle.title,
        description: puzzle.description,
        difficulty: puzzle.difficulty,
        category: puzzle.category,
        type: puzzle.type,
        fen: puzzle.fen,
        solutionMoves: puzzle.solutionMoves,
        alternativeSolutions: puzzle.alternativeSolutions || [],
        firstMoveBy: puzzle.firstMoveBy || 'human',
        captureConfig: puzzle.captureConfig || puzzle.kidsConfig,
        illegalConfig: puzzle.illegalConfig || null,
        level: puzzle.level,
        rating: puzzle.rating,

        // Status information
        status,
        isSolved,
        isFailed,
        isLocked,

        // Attempt data
        solvedData: attemptData || solvedData || null,
        boardPosition: attemptData?.boardPosition || null,
        moveHistory: attemptData?.moveHistory || []
      };
    });

    console.log('Final puzzles with status:', puzzlesWithStatus.map(p => ({
      id: p._id,
      status: p.status,
      isSolved: p.isSolved,
      isFailed: p.isFailed,
      isLocked: p.isLocked
    })));

    const eventRoundData = await EventRoundModel.findOne({ competitionId }).select("eventId").lean();

    res.json({
      success: true,
      competition: {
        id: competition._id,
        name: competition.name,
        status: competition.status,
        startTime: competition.startTime,
        endTime: competition.endTime,
        totalPuzzles: competition.puzzles.length,
        chapters: competition.chapters || [],
        eventId: eventRoundData ? eventRoundData.eventId : null
      },
      puzzles: puzzlesWithStatus,
      participant: {
        score: participant.score,
        puzzlesSolved: participant.puzzlesSolved,
        timeSpent: participant.timeSpent,
        joinedAt: participant.joinedAt,
        isMuted: participant.isMuted || false,
        isBlocked: participant.isBlocked || false
      }
    });

  } catch (error) {
    console.error('Error fetching competition puzzles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch competition puzzles'
    });
  }
};

// Start competition (Admin only)
export const startCompetition = async (req, res) => {
  try {
    const { competitionId } = req.params;

    const competition = await CompetitionModel.findById(competitionId);
    if (!competition) {
      return res.status(404).json({
        success: false,
        message: 'Competition not found'
      });
    }

    if (competition.status === 'LIVE') {
      return res.status(400).json({
        success: false,
        message: 'Competition is already live'
      });
    }

    if (competition.status === 'ENDED') {
      return res.status(400).json({
        success: false,
        message: 'Competition has already ended'
      });
    }

    // Update competition status
    competition.status = 'LIVE';
    competition.isActive = true;
    // Only set startTime if it hasn't been set yet — don't overwrite a
    // pre-configured startTime, as that would break time-based checks for
    // users who joined before the admin clicked "Start".
    if (!competition.startTime || competition.startTime > new Date()) {
      competition.startTime = new Date();
    }
    await competition.save();

    // Schedule competition end
    scheduleCompetitionEnd(io, competitionId, competition.endTime);

    res.json({
      success: true,
      message: 'Competition started successfully',
      competition: {
        id: competition._id,
        name: competition.name,
        status: competition.status,
        startTime: competition.startTime,
        endTime: competition.endTime
      }
    });

  } catch (error) {
    console.error('Error starting competition:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start competition'
    });
  }
};

export const getLobbyState = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const userId = req.user._id;
    const now = new Date();

    // 1. Fetch competition (only required fields)
    //console.time("competitionQuery");
    const competition = await CompetitionModel
      .findById(competitionId)
      .select("name startTime endTime duration puzzles status isActive accessCode")
      .lean();
    //console.timeEnd("competitionQuery");

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found"
      });
    }

    // 2. Fetch participant (only status)
    //console.time("participantQuery");
    const participant = await ParticipantModel
      .findOne({ competitionId, userId })
      .select("status")
      .lean();
    //console.timeEnd("participantQuery");

    // 3. Determine competition state
    let competitionState = competition.status?.toUpperCase() || "UPCOMING";

    if (
      competitionState === "UPCOMING" &&
      now >= competition.startTime &&
      now <= competition.endTime
    ) {
      competitionState = "LIVE";

      // Async update (non-blocking)
      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: "LIVE", isActive: true }
      ).catch(() => { });
    }

    if (now > competition.endTime && competitionState !== "ENDED") {
      competitionState = "ENDED";

      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: "ENDED", isActive: false }
      ).catch(() => { });
    }

    // 4. Participant state
    const participantState = participant?.status || "NOT_JOINED";

    // 5. Leaderboard — skip for ENDED competitions (Leaderboard page handles that)
    let leaderboard = [];
    if (competitionState !== "ENDED") {
      leaderboard = await getCurrentLeaderboard(competitionId);
    }

    // 6. Response
    return res.json({
      success: true,
      competition: {
        id: competition._id,
        name: competition.name,
        startTime: competition.startTime,
        endTime: competition.endTime,
        duration: competition.duration,
        totalPuzzles: competition.puzzles?.length || 0,
        requiresAccessCode: !!competition.accessCode?.trim()
      },
      competitionState,
      participantState,
      leaderboard,
      serverTime: Date.now()
    });

  } catch (err) {
    console.error("Lobby state error:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};


// Helper function to calculate score
// All puzzles are worth 10 points - winner determined by time taken
const calculateScore = (difficulty, timeSpent) => {
  return 10; // Fixed score for all puzzles
};

// Check for active participation
export const getActiveParticipation = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find participant record where:
    // 1. User is the current user
    // 2. Not submitted yet
    const participations = await ParticipantModel.find({
      userId,
      isSubmitted: false,
      isBlocked: { $ne: true }
    }).populate('competitionId');

    // Filter for active/upcoming competitions
    const now = new Date();
    const activeParticipation = participations.find(p => {
      const comp = p.competitionId;
      if (!comp) return false;

      // Allow if LIVE OR UPCOMING (near start)
      // Check status strings case-insensitively
      const status = comp.status?.toUpperCase();

      const isLive = status === 'LIVE';
      const isUpcoming = status === 'UPCOMING';

      // If live, standard check
      if (isLive) {
        return new Date(comp.endTime) > now;
      }

      // If upcoming, always allow rejoining/waiting if within sensible range (or just all joined upcoming)
      // The user wants "popup logic that tournanment is running or about to start"
      if (isUpcoming) {
        return true;
      }

      return false;
    });

    if (activeParticipation) {
      return res.json({
        success: true,
        hasActiveParticipation: true,
        competition: {
          id: activeParticipation.competitionId._id,
          name: activeParticipation.competitionId.name,
          endTime: activeParticipation.competitionId.endTime
        }
      });
    }

    return res.json({
      success: true,
      hasActiveParticipation: false
    });

  } catch (error) {
    console.error('Check active participation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

export const getPuzzlesForEvent = async (req, res) => {
  try {
    const {
      category,
      difficulty,
      type,
      level,
      rating,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    // Apply filters
    if (category && category !== 'all') query.category = category;
    if (difficulty && difficulty !== 'all') query.difficulty = difficulty;
    if (type && type !== 'all') query.type = type;
    if (level && level !== 'all') query.level = parseInt(level);
    if (rating && rating !== 'all') query.rating = parseInt(rating);

    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const puzzles = await PuzzleModel.find(query)
      .populate("createdBy", "name")
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PuzzleModel.countDocuments(query);

    // Get filter options for frontend
    const categories = await PuzzleModel.distinct('category');
    const difficulties = await PuzzleModel.distinct('difficulty');
    const types = await PuzzleModel.distinct('type');
    const levels = await PuzzleModel.distinct('level');
    const ratings = await PuzzleModel.distinct('rating');

    res.status(200).json({
      success: true,
      data: puzzles,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: puzzles.length,
        totalRecords: total
      },
      filters: {
        categories: categories.filter(Boolean),
        difficulties: difficulties.filter(Boolean),
        types: types.filter(Boolean),
        levels: levels.filter(val => val !== null && val !== undefined).sort((a, b) => a - b),
        ratings: ratings.filter(val => val !== null && val !== undefined).sort((a, b) => a - b)
      }
    });
  } catch (error) {
    console.error("Error fetching puzzles for event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch puzzles"
    });
  }
};

// Get puzzles by IDs (for fetching assigned puzzles in events)
export const getPuzzlesByIds = async (req, res) => {
  try {
    const { puzzleIds } = req.body;

    if (!puzzleIds || !Array.isArray(puzzleIds) || puzzleIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "puzzleIds array is required"
      });
    }

    // Fetch puzzles by their IDs
    const puzzles = await PuzzleModel.find({
      _id: { $in: puzzleIds }
    }).populate("createdBy", "name");

    res.status(200).json({
      success: true,
      data: puzzles
    });
  } catch (error) {
    console.error("Error fetching puzzles by IDs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch puzzles"
    });
  }
}

// Mute/unmute a participant's chat in a competition
export const muteParticipant = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const { userId, isMuted } = req.body;

    const participant = await ParticipantModel.findOneAndUpdate(
      { competitionId, userId },
      { isMuted },
      { new: true }
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "Participant not found"
      });
    }

    // Broadcast chat update to all users in the competition room
    io.to(`competition_${competitionId}`).emit("userMuted", {
      userId,
      isMuted
    });

    return res.json({
      success: true,
      message: isMuted ? "Participant muted successfully" : "Participant unmuted successfully",
      participant
    });
  } catch (error) {
    console.error("Error muting participant:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during muting"
    });
  }
};

// Block/kick a participant from the competition arena
export const blockParticipant = async (req, res) => {
  try {
    const { competitionId } = req.params;
    const { userId, isBlocked } = req.body;

    const participant = await ParticipantModel.findOneAndUpdate(
      { competitionId, userId },
      { isBlocked, isActive: !isBlocked },
      { new: true }
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "Participant not found"
      });
    }

    // If blocked, evict from Redis leaderboard
    if (isBlocked) {
      try {
        const key = leaderboardKey(competitionId);
        const metaKey = leaderboardMetaKey(competitionId);
        const pipeline = redis.pipeline();
        pipeline.zrem(key, userId);
        pipeline.hdel(metaKey, userId);
        await pipeline.exec();
        console.log(`[Admin block] Evicted blocked user ${userId} from Redis leaderboard for ${competitionId}`);
      } catch (redisErr) {
        console.error("Redis eviction error during block:", redisErr);
      }
    } else {
      // Re-add to Redis leaderboard if unblocked
      try {
        await upsertLeaderboardEntry(competitionId, {
          userId: participant.userId.toString(),
          username: participant.username,
          score: participant.score,
          puzzlesSolved: participant.puzzlesSolved,
          timeSpent: participant.timeSpent,
          status: participant.status,
          submittedAt: participant.submittedAt
        });
      } catch (redisErr) {
        console.error("Redis restore error during unblock:", redisErr);
      }
    }

    // Broadcast updated leaderboard to the room
    const leaderboard = await getCurrentLeaderboard(competitionId);
    io.to(`competition_${competitionId}`).emit("leaderboardUpdate", leaderboard);

    // Broadcast block event to all users in the competition room (so the user is kicked in real-time)
    io.to(`competition_${competitionId}`).emit("userBlocked", {
      userId,
      isBlocked
    });

    return res.json({
      success: true,
      message: isBlocked ? "Participant blocked from arena" : "Participant unblocked from arena",
      participant
    });
  } catch (error) {
    console.error("Error blocking participant:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during blocking"
    });
  }
};

export default {
  participateInCompetition,
  submitPuzzleSolution,
  getLiveLeaderboard,
  getCompetitionPuzzles,
  startCompetition,
  submitCompetition,
  getActiveParticipation,
  getLobbyState,
  getPuzzlesForEvent,
  getPuzzlesByIds,
  muteParticipant,
  blockParticipant
};