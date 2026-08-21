import CompetitionModel from "../models/CompetitionSchema.js";
import ParticipantModel from "../models/ParticipantSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import { io } from "../index.js";

import { scheduleCompetitionEnd, getCurrentLeaderboard, handleCompetitionEnd, upsertLeaderboardEntry, addParticipantToLeaderboard, getIO, emitLeaderboardUpdateDebounced, getLeaderboardParticipantStatus } from "../utils/socketHandlers.js";
import {
  buildIdempotentAttemptResponse,
  upsertTerminalAttempt,
  calcTotalSolveTime,
  normalizePuzzleTimeSpent,
  sanitizeStoredSolveSeconds,
  getValidPuzzleIds,
} from "../utils/puzzleAttemptUtils.js";
import { validatePuzzleSolution } from "../utils/puzzleValidationUtils.js";
import {
  getCachedActiveParticipation,
  setCachedActiveParticipation,
  invalidateActiveParticipationCache,
} from "../utils/activeParticipationCache.js";
import {
  getPuzzleForValidation,
  primePuzzlesForValidation,
  setCachedCompetitionLiveMeta,
  getRedisCompetitionLiveMeta,
  invalidateCompetitionLiveMeta,
  getValidPuzzleIdsCached,
  getCachedPuzzleList,
  setCachedPuzzleList,
  PUZZLE_LIVE_SELECT,
} from "../utils/liveCompetitionCache.js";
import { parseLeaderboardPaging } from "../utils/paging.js";
import { acquireSubmitLock, releaseSubmitLock } from "../utils/submitLock.js";
import { recordCounter } from "../utils/cacheMetrics.js";
import { getPuzzleFilterOptions } from "../utils/puzzleFilterCache.js";

async function getCompetitionTimingMeta(competitionId) {
  const cached = await getRedisCompetitionLiveMeta(competitionId);
  if (cached) return cached;
  const competition = await CompetitionModel.findById(competitionId)
    .select("name status startTime endTime duration puzzles chapters accessCode")
    .lean();
  if (competition) setCachedCompetitionLiveMeta(competitionId, competition);
  return competition;
}

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

    // Create participant (Participant collection is the source of truth)
    let participant;
    try {
      participant = await ParticipantModel.create({
        competitionId,
        userId,
        username: username || req.user.username || req.user.name,
        status: "JOINED",
        joinedAt: new Date(),
        score: 0,
        puzzlesSolved: 0,
        timeSpent: 0,
      });
    } catch (createErr) {
      if (createErr?.code === 11000) {
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
      throw createErr;
    }

    if (competition.maxParticipants) {
      const remaining = competition.maxParticipants - participantCount;
      if (remaining <= 3) {
        const countAfter = await ParticipantModel.countDocuments({ competitionId });
        if (countAfter > competition.maxParticipants) {
          await ParticipantModel.deleteOne({ _id: participant._id });
          return res.status(400).json({
            success: false,
            error: "Competition is full",
          });
        }
      }
    }

    invalidateActiveParticipationCache(userId);

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
        puzzleCount: competition.puzzles?.length || 0,
        chapters: competition.chapters || [],
        maxScore: (competition.puzzles?.length || 0) * 10,
        status: competition.status,
        participantCount: participantCount + 1,
      },
    });

    // Run Redis + Socket operations in background
    setImmediate(async () => {
      try {
        await addParticipantToLeaderboard(competition._id, participant);

        const roomName = `competition_${competitionId}`;
        io.to(roomName).emit("participantJoined", {
          username: participant.username,
          userId: participant.userId.toString(),
        });

        // Ensure end timer is scheduled for manually-created LIVE competitions
        if (
          (competition.status === "LIVE" || competition.status === "live") &&
          competition.endTime
        ) {
          scheduleCompetitionEnd(io, competitionId, competition.endTime);
        }
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
    const competition = await CompetitionModel.findById(competitionId)
      .select("status puzzles endTime")
      .lean();
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
    let participant = await ParticipantModel.findOne({
      competitionId,
      userId,
    });

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "You are not participating in this competition",
      });
    }

    // ── Validate all puzzles are attempted ────────────────────────────────────
    // Deduplicate puzzle IDs first.
    const uniquePuzzleIds = [
      ...new Set((competition.puzzles || []).map((id) => id.toString()))
    ];

    const validPuzzleIds = await getValidPuzzleIdsCached(
      competitionId,
      uniquePuzzleIds,
      getValidPuzzleIds
    );

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

    // ── Mark as submitted (atomic — idempotent on retry) ─────────────────────
    const submittedAt = new Date();
    let timeSpent = sanitizeStoredSolveSeconds(participant.timeSpent);
    if (!timeSpent) {
      timeSpent = await calcTotalSolveTime(competitionId, userId);
    }

    const updatedParticipant = await ParticipantModel.findOneAndUpdate(
      {
        competitionId,
        userId,
        status: { $ne: "SUBMITTED" },
        submittedAt: { $exists: false },
      },
      {
        $set: {
          status: "SUBMITTED",
          isSubmitted: true,
          isActive: false,
          submittedAt,
          timeSpent,
        },
      },
      { new: true }
    );

    if (!updatedParticipant) {
      const existing = await ParticipantModel.findOne({ competitionId, userId }).lean();
      if (existing?.status === "SUBMITTED" || existing?.submittedAt) {
        return res.json({
          success: true,
          message: "Competition already submitted",
          finalScore: existing.score,
          puzzlesSolved: existing.puzzlesSolved,
          timeSpent: existing.timeSpent,
        });
      }
      return res.status(409).json({
        success: false,
        message: "Could not submit competition. Please try again.",
      });
    }

    participant = updatedParticipant;
    invalidateActiveParticipationCache(userId);

    // ── Sync Redis ───────────────────────────────────────────────────────────
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

    const roomName = `competition_${competitionId}`;

    io.to(roomName).emit("participantSubmitted", {
      username     : participant.username,
      userId       : participant.userId,
      score        : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
      totalSolveTime: participant.timeSpent,
    });

    emitLeaderboardUpdateDebounced(competitionId);

    res.json({
      success      : true,
      message      : "Competition submitted successfully",
      finalScore   : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
    });

    setImmediate(async () => {
      try {
        const [totalParticipants, submittedParticipants] = await Promise.all([
          ParticipantModel.countDocuments({ competitionId }),
          ParticipantModel.countDocuments({
            competitionId,
            $or: [
              { isSubmitted: true },
              { submittedAt: { $exists: true } },
            ],
          }),
        ]);
        if (totalParticipants > 0 && submittedParticipants >= totalParticipants) {
          console.log("All participants submitted. Ending competition early.");
          handleCompetitionEnd(io, competitionId);
        }
      } catch (err) {
        console.error("[Controller] post-submit end check failed:", err);
      }
    });
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

    const lockHeld = await acquireSubmitLock(competitionId, userId, puzzleId);
    if (!lockHeld) {
      recordCounter("submitLockConflicts");
      const [existingAttempt, participant] = await Promise.all([
        PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId })
          .select("status scoreEarned")
          .lean(),
        ParticipantModel.findOne({ competitionId, userId })
          .select("score puzzlesSolved")
          .lean(),
      ]);
      if (existingAttempt && (existingAttempt.status === "solved" || existingAttempt.status === "failed")) {
        return res.json(buildIdempotentAttemptResponse(existingAttempt, participant));
      }
      return res.status(409).json({
        success: false,
        message: "Submission already in progress. Retry shortly.",
      });
    }

    try {
      const [competition, participant, existingAttempt, puzzle] = await Promise.all([
        getCompetitionTimingMeta(competitionId),
        ParticipantModel.findOne({ competitionId, userId })
          .select("status score puzzlesSolved timeSpent username userId submittedAt")
          .lean(),
        PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId })
          .select("status scoreEarned")
          .lean(),
        getPuzzleForValidation(puzzleId),
      ]);

      if (!competition || new Date() > competition.endTime) {
        return res.status(400).json({
          success: false,
          message: "Competition has ended",
        });
      }

      const now = new Date();
      const isTimeLive =
        now >= competition.startTime && now <= competition.endTime;

      if (competition.status !== "LIVE" && !isTimeLive) {
        return res.status(400).json({
          success: false,
          message: "Competition is not live",
        });
      }

      if (competition.status !== "LIVE" && isTimeLive) {
        CompetitionModel.updateOne(
          { _id: competitionId },
          { status: "LIVE", isActive: true }
        ).catch(() => {});
      }

      if (!participant) {
        return res.status(404).json({
          success: false,
          message: "You are not participating in this competition",
        });
      }

      if (participant.status === "SUBMITTED") {
        return res.status(400).json({
          success: false,
          message: "You have already submitted the competition",
        });
      }

      if (
        existingAttempt &&
        (existingAttempt.status === "solved" ||
          existingAttempt.status === "failed")
      ) {
        return res.json(
          buildIdempotentAttemptResponse(existingAttempt, participant)
        );
      }

      if (!puzzle) {
        return res.status(404).json({
          success: false,
          message: "Puzzle not found",
        });
      }

      const becamePlaying = participant.status === "JOINED";

      const { isCorrect, scoreOverride } = validatePuzzleSolution(
        puzzle,
        solution,
        moveCount,
        moveHistory
      );

      const puzzleTimeIncrement = timeSpent;

      if (isCorrect) {
        const scoreEarned = scoreOverride !== null ? scoreOverride : calculateScore(puzzle.difficulty, timeSpent);

        let solveMessage = "Puzzle solved successfully!";
        if (puzzle.type === 'capture' && scoreOverride !== null) {
          const moveLimit = parseInt(puzzle.captureConfig?.maximumNoOfMoves) || 0;
          solveMessage = `Captured after exceeding the ${moveLimit}-move limit. Half marks awarded.`;
        } else if (puzzle.type === 'capture') {
          const moveLimit = parseInt(puzzle.captureConfig?.maximumNoOfMoves) || 0;
          if (moveLimit > 0) solveMessage = `Captured within the ${moveLimit}-move limit. Full marks awarded!`;
        }

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

        if (!attemptDoc) {
          const settled = await PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId })
            .select("status scoreEarned")
            .lean();
          return res.json(buildIdempotentAttemptResponse(settled, participant));
        }

        const updatedParticipant = await ParticipantModel.findOneAndUpdate(
          { competitionId, userId, status: { $ne: "SUBMITTED" } },
          {
            $inc: {
              score: scoreEarned,
              puzzlesSolved: 1,
              timeSpent: puzzleTimeIncrement,
            },
            $set: {
              lastActivity: new Date(),
              ...(becamePlaying ? { status: "PLAYING" } : {}),
            },
          },
          { new: true, select: "userId username score puzzlesSolved timeSpent status submittedAt" }
        );

        const responsePayload = {
          success      : true,
          isCorrect    : true,
          scoreEarned,
          totalScore   : updatedParticipant?.score ?? (participant.score + scoreEarned),
          puzzlesSolved: updatedParticipant?.puzzlesSolved ?? (participant.puzzlesSolved + 1),
          puzzleStatus : "solved",
          message      : solveMessage,
          isHalfScore  : scoreOverride !== null,
        };

        res.json(responsePayload);

        if (updatedParticipant) {
          setImmediate(async () => {
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

            io.to(`competition_${competitionId}`).emit("liveScoreUpdate", {
              userId       : updatedParticipant.userId,
              username     : updatedParticipant.username,
              score        : updatedParticipant.score,
              puzzlesSolved: updatedParticipant.puzzlesSolved,
              timeSpent    : updatedParticipant.timeSpent,
              totalSolveTime: updatedParticipant.timeSpent,
              status       : updatedParticipant.status,
            });

            if (becamePlaying) {
              io.to(`competition_${competitionId}`).emit("player-progress", {
                userId,
                participantState: "PLAYING",
              });
            }

            emitLeaderboardUpdateDebounced(competitionId);
          });
        }

        return;
      }

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

      if (!failedAttempt) {
        const settled = await PuzzleAttemptModel.findOne({ competitionId, puzzleId, userId })
          .select("status scoreEarned")
          .lean();
        return res.json(buildIdempotentAttemptResponse(settled, participant));
      }

      const updatedParticipant = await ParticipantModel.findOneAndUpdate(
        { competitionId, userId, status: { $ne: "SUBMITTED" } },
        {
          $inc: { timeSpent: puzzleTimeIncrement },
          $set: {
            lastActivity: new Date(),
            ...(becamePlaying ? { status: "PLAYING" } : {}),
          },
        },
        { new: true, select: "userId username score puzzlesSolved timeSpent status submittedAt" }
      );

      const failPayload = {
        success      : false,
        isCorrect    : false,
        scoreEarned  : 0,
        totalScore   : updatedParticipant?.score ?? participant.score,
        puzzlesSolved: updatedParticipant?.puzzlesSolved ?? participant.puzzlesSolved,
        puzzleStatus : "failed",
        message      : "Incorrect solution.",
      };

      res.json(failPayload);

      if (updatedParticipant) {
        setImmediate(async () => {
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

          if (becamePlaying) {
            io.to(`competition_${competitionId}`).emit("player-progress", {
              userId,
              participantState: "PLAYING",
            });
          }

          emitLeaderboardUpdateDebounced(competitionId);
        });
      }

      return;
    } finally {
      await releaseSubmitLock(competitionId, userId, puzzleId);
    }
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
    const competition = await getCompetitionTimingMeta(competitionId);

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found",
      });
    }

    const now = new Date();
    if (now > competition.endTime && competition.status !== "ENDED") {
      competition.status = "ENDED";
    }

    // Run leaderboard + participant queries in parallel
    const { limit, skip } = parseLeaderboardPaging(req.query);
    const [leaderboard, redisStatus] = await Promise.all([
      getCurrentLeaderboard(competitionId, limit, skip),
      userId ? getLeaderboardParticipantStatus(competitionId, userId) : Promise.resolve("NOT_JOINED"),
    ]);

    let participantState = redisStatus;
    if (userId && redisStatus == null) {
      const participant = await ParticipantModel.findOne({ competitionId, userId })
        .select("status")
        .lean();
      participantState = participant ? participant.status : "NOT_JOINED";
    } else if (!userId) {
      participantState = "NOT_JOINED";
    }

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

    const competition = await CompetitionModel.findById(competitionId)
      .select("name status startTime endTime puzzles chapters")
      .lean();

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: 'Competition not found'
      });
    }

    const now = new Date();
    const isTimeLive = now >= competition.startTime && now <= competition.endTime;
    if (competition.status === 'UPCOMING' && isTimeLive) {
      competition.status = 'LIVE';
      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: 'LIVE', isActive: true }
      ).catch(() => {});
    }

    // Retry participant lookup after join race before returning 403.
    let participant = await ParticipantModel.findOne({ competitionId, userId }).lean();

    if (!participant) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        participant = await ParticipantModel.findOne({ competitionId, userId }).lean();
        if (participant) break;
      }
    }

    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'Not a participant in this competition'
      });
    }

    const puzzleIds = (competition.puzzles || []).map((id) => id.toString());

    const cachedPuzzles = await getCachedPuzzleList(competitionId);
    const [puzzles, puzzleAttempts] = await Promise.all([
      cachedPuzzles
        ? Promise.resolve(cachedPuzzles)
        : PuzzleModel.find({ _id: { $in: puzzleIds } })
            .select(PUZZLE_LIVE_SELECT)
            .lean(),
      PuzzleAttemptModel.find({ competitionId, userId })
        .select("puzzleId status scoreEarned timeSpent completedAt boardPosition moveHistory isLocked")
        .lean(),
    ]);

    if (!cachedPuzzles) {
      setCachedPuzzleList(competitionId, puzzles);
    } else {
      primePuzzlesForValidation(puzzles);
    }

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

    // Prepare puzzles with solved status and attempt data
    const puzzlesWithStatus = puzzles
      .filter(Boolean)
      .map((puzzle) => {
      if (!puzzle?._id) return null;
      const puzzleId = puzzle._id.toString();
      const attemptData = attemptsMap.get(puzzleId);

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
        solvedData: attemptData || null,
        boardPosition: attemptData?.boardPosition || null,
        moveHistory: attemptData?.moveHistory || []
      };
    })
      .filter(Boolean);

    res.json({
      success: true,
      competition: {
        id: competition._id,
        name: competition.name,
        status: competition.status,
        startTime: competition.startTime,
        endTime: competition.endTime,
        totalPuzzles: puzzleIds.length,
        chapters: competition.chapters || []
      },
      puzzles: puzzlesWithStatus,
      participant: {
        score: participant.score,
        puzzlesSolved: participant.puzzlesSolved,
        timeSpent: participant.timeSpent,
        joinedAt: participant.joinedAt
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

    const competition = await CompetitionModel.findById(competitionId)
      .select("name status startTime endTime")
      .lean();
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

    const now = new Date();
    const startTime =
      !competition.startTime || competition.startTime > now
        ? now
        : competition.startTime;

    // findByIdAndUpdate avoids rewriting the legacy embedded participants[] array
    await CompetitionModel.findByIdAndUpdate(competitionId, {
      $set: {
        status: "LIVE",
        isActive: true,
        startTime,
      },
    });
    invalidateCompetitionLiveMeta(competitionId);

    // Schedule competition end
    scheduleCompetitionEnd(io, competitionId, competition.endTime);

    res.json({
      success: true,
      message: 'Competition started successfully',
      competition: {
        id: competition._id,
        name: competition.name,
        status: "LIVE",
        startTime,
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

    const [competition, participant, leaderboard] = await Promise.all([
      getCompetitionTimingMeta(competitionId),
      ParticipantModel.findOne({ competitionId, userId }).select("status").lean(),
      getCurrentLeaderboard(competitionId),
    ]);

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found"
      });
    }

    if (now > competition.endTime) {
      competition.status = "ENDED";
    }

    let competitionState = competition.status?.toUpperCase() || "UPCOMING";

    if (
      competitionState === "UPCOMING" &&
      now >= competition.startTime &&
      now <= competition.endTime
    ) {
      competitionState = "LIVE";

      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: "LIVE", isActive: true }
      ).catch(() => { });

      scheduleCompetitionEnd(getIO(), competitionId, competition.endTime);
    }

    if (now > competition.endTime) {
      competitionState = "ENDED";

      CompetitionModel.updateOne(
        { _id: competitionId },
        { status: "ENDED", isActive: false }
      ).catch(() => { });
    }

    const participantState = participant?.status || "NOT_JOINED";

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
      leaderboard: (competitionState === "ENDED" || competitionState === "LIVE") ? leaderboard : [],
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
    const cached = getCachedActiveParticipation(userId);
    if (cached) {
      return res.json(cached);
    }

    const now = new Date();

    const participations = await ParticipantModel.find({
      userId,
      isSubmitted: false,
    })
      .select("competitionId")
      .lean();

    if (!participations.length) {
      const payload = {
        success: true,
        hasActiveParticipation: false,
      };
      setCachedActiveParticipation(userId, payload);
      return res.json(payload);
    }

    const competitionIds = participations.map((p) => p.competitionId);
    const competitions = await CompetitionModel.find({
      _id: { $in: competitionIds },
      status: { $in: ["LIVE", "UPCOMING", "live", "upcoming"] },
    })
      .select("name endTime status")
      .lean();

    const competitionMap = new Map(
      competitions.map((comp) => [comp._id.toString(), comp])
    );

    const activeParticipation = participations.find((p) => {
      const comp = competitionMap.get(p.competitionId.toString());
      if (!comp) return false;

      const status = comp.status?.toUpperCase();
      if (status === "LIVE") {
        return new Date(comp.endTime) > now;
      }
      if (status === "UPCOMING") {
        return true;
      }
      return false;
    });

    if (activeParticipation) {
      const comp = competitionMap.get(
        activeParticipation.competitionId.toString()
      );
      const payload = {
        success: true,
        hasActiveParticipation: true,
        competition: {
          id: comp._id,
          name: comp.name,
          endTime: comp.endTime,
        },
      };
      setCachedActiveParticipation(userId, payload);
      return res.json(payload);
    }

    const payload = {
      success: true,
      hasActiveParticipation: false,
    };
    setCachedActiveParticipation(userId, payload);
    return res.json(payload);

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

    const [puzzles, total, filterOptions] = await Promise.all([
      PuzzleModel.find(query)
        .populate("createdBy", "name")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      PuzzleModel.countDocuments(query),
      getPuzzleFilterOptions(),
    ]);

    const { categories, difficulties, types, levels, ratings } = filterOptions;

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
  getPuzzlesByIds
};