import EventModel from "../models/EventSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import { io } from "../index.js";

import {
  buildIdempotentAttemptResponse,
  upsertTerminalAttempt,
  calcTotalSolveTime,
  normalizePuzzleTimeSpent,
  sanitizeStoredSolveSeconds,
} from "../utils/puzzleAttemptUtils.js";
import { validatePuzzleSolution } from "../utils/puzzleValidationUtils.js";
import {
  getPuzzleForValidation,
  primePuzzlesForValidation,
  PUZZLE_LIVE_SELECT,
} from "../utils/liveCompetitionCache.js";
import {
  getCurrentEventLeaderboard,
  handleEventEnd,
  upsertEventLeaderboardEntry,
  addEventParticipantToLeaderboard,
  emitEventLeaderboardUpdateDebounced,
} from "../utils/socketEventHandlers.js";

// Participate in live event (Lobby + Spectator view)
export const participateInEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    const event = await EventModel.findById(eventId)
      .select("name description startTime endTime duration status accessCode maxParticipants puzzles chapters entryFeeType entryFeeAmount")
      .lean();

    if (!event) {
      return res.status(404).json({
        success: false,
        error: "Event not found",
      });
    }

    const now = new Date();

    if (event.status === "ENDED" || now > event.endTime) {
      return res.status(400).json({
        success: false,
        error: "Event has ended",
      });
    }

    // Check if registered
    const participant = await EventParticipantModel.findOne({ eventId, userId }).lean();

    if (!participant) {
      return res.status(403).json({
        success: false,
        error: "You must register for this event first",
        notRegistered: true,
      });
    }

    const participantCount = await EventParticipantModel.countDocuments({ eventId, isApproved: true });

    // If user is NOT approved, they can only spectate (see lobby & participants)
    if (!participant.isApproved) {
      return res.json({
        success: true,
        spectator: true,
        isApproved: false,
        message: "Registration is pending approval. Spectating only.",
        event: {
          id: event._id,
          name: event.name,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime,
          duration: event.duration,
          status: event.status,
          participantCount,
          puzzles: event.puzzles || [],
          chapters: event.chapters || [],
          totalPuzzles: event.puzzles?.length || 0,
          entryFeeType: event.entryFeeType || "free",
          entryFeeAmount: event.entryFeeAmount || 0,
        },
      });
    }

    // If already playing and submitted
    if (participant.submittedAt) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted this event",
      });
    }

    // Approved participant joining the event to play
    res.json({
      success: true,
      spectator: false,
      isApproved: true,
      event: {
        id: event._id,
        name: event.name,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        duration: event.duration,
        puzzles: event.puzzles,
        chapters: event.chapters || [],
        totalPuzzles: event.puzzles?.length || 0,
        maxScore: (event.puzzles?.length || 0) * 10,
        status: event.status,
        participantCount,
        entryFeeType: event.entryFeeType || "free",
        entryFeeAmount: event.entryFeeAmount || 0,
      },
    });

    // Background sync for leaderboard
    setImmediate(async () => {
      try {
        await addEventParticipantToLeaderboard(eventId, participant);
        const roomName = `event_${eventId}`;
        io.to(roomName).emit("eventParticipantJoined", {
          username: participant.username,
          userId: participant.userId.toString(),
        });
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

// Submit event early
export const submitEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    const event = await EventModel.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (event.status !== "LIVE") {
      return res.status(400).json({
        success: false,
        message: "Event is not currently active",
      });
    }

    let participant = await EventParticipantModel.findOne({
      eventId,
      userId,
      isApproved: true
    });

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "You are not participating in this event or not approved",
      });
    }

    // ── Validate all puzzles are attempted ────────────────────────────────────
    // Deduplicate — same logic as competition submit to avoid false "remaining" errors.
    const uniquePuzzleIds = [
      ...new Set((event.puzzles || []).map((id) => id.toString()))
    ];

    // Filter out ghost IDs — puzzles deleted from the Puzzle collection after
    // the event was created. Frontend never shows them (populate returns null),
    // so users can never attempt them. Don't count them in totalPuzzles.
    const existingPuzzleDocs = await PuzzleModel.find(
      { _id: { $in: uniquePuzzleIds } },
      { _id: 1 }
    ).lean();
    const existingPuzzleIdSet = new Set(existingPuzzleDocs.map(p => p._id.toString()));
    const validPuzzleIds = uniquePuzzleIds.filter(id => existingPuzzleIdSet.has(id));

    const totalPuzzles = validPuzzleIds.length;

    const attemptedDocs = await PuzzleAttemptModel.find({
      competitionId: eventId,
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

    const submittedAt = new Date();
    const timeSpent = Math.max(
      sanitizeStoredSolveSeconds(participant.timeSpent),
      await calcTotalSolveTime(eventId, userId)
    );

    const updatedParticipant = await EventParticipantModel.findOneAndUpdate(
      {
        eventId,
        userId,
        isApproved: true,
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
      const existing = await EventParticipantModel.findOne({ eventId, userId, isApproved: true }).lean();
      if (existing?.status === "SUBMITTED" || existing?.submittedAt) {
        return res.json({
          success: true,
          message: "Event already submitted",
          finalScore: existing.score,
          puzzlesSolved: existing.puzzlesSolved,
          timeSpent: existing.timeSpent,
        });
      }
      return res.status(409).json({
        success: false,
        message: "Could not submit event. Please try again.",
      });
    }

    participant = updatedParticipant;

    try {
      await upsertEventLeaderboardEntry(eventId, {
        userId       : participant.userId.toString(),
        username     : participant.username,
        score        : participant.score        || 0,
        puzzlesSolved: participant.puzzlesSolved || 0,
        timeSpent    : participant.timeSpent     || 0,
        status       : "SUBMITTED",
        submittedAt  : participant.submittedAt,
      });
    } catch (redisError) {
      console.error("[Event Leaderboard] Redis upsert error in submitEvent:", redisError);
    }

    const roomName = `event_${eventId}`;
    io.to(roomName).emit("eventParticipantSubmitted", {
      username     : participant.username,
      userId       : participant.userId,
      score        : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
      totalSolveTime: participant.timeSpent,
    });

    emitEventLeaderboardUpdateDebounced(eventId);

    // End event early if everyone has submitted
    const totalParticipants = await EventParticipantModel.countDocuments({ eventId, isApproved: true });
    const submittedParticipants = await EventParticipantModel.countDocuments({
      eventId,
      isApproved: true,
      $or: [
        { isSubmitted: true },
        { submittedAt: { $exists: true } },
      ],
    });

    res.json({
      success      : true,
      message      : "Event submitted successfully",
      finalScore   : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
    });

    if (totalParticipants > 0 && submittedParticipants >= totalParticipants) {
      setTimeout(() => {
        handleEventEnd(io, eventId);
      }, 100);
    }
  } catch (error) {
    console.error("[Controller] Event submission error:", error);
    res.status(500).json({
      success: false,
      error  : "Server error during submission",
    });
  }
};

// Submit puzzle solution for event
export const submitEventPuzzleSolution = async (req, res) => {
  try {
    const { eventId, puzzleId } = req.params;
    const { solution, timeSpent: rawTimeSpent, boardPosition, moveHistory, moveCount } = req.body;
    const timeSpent = normalizePuzzleTimeSpent(rawTimeSpent);
    const userId = req.user._id;

    const [event, participant, existingAttempt, puzzle] = await Promise.all([
      EventModel.findById(eventId).select("startTime endTime status").lean(),
      EventParticipantModel.findOne({ eventId, userId, isApproved: true }),
      PuzzleAttemptModel.findOne({ competitionId: eventId, puzzleId, userId }),
      getPuzzleForValidation(puzzleId),
    ]);

    if (!event || new Date() > event.endTime) {
      return res.status(400).json({
        success: false,
        message: "Event has ended",
      });
    }

    if (event.status !== "LIVE") {
      return res.status(400).json({
        success: false,
        message: "Event is not live",
      });
    }

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: "You are not participating in this event or not approved",
      });
    }

    if (participant.status === "SUBMITTED") {
      return res.status(400).json({
        success: false,
        message: "You have already submitted the event",
      });
    }

    if (existingAttempt && (existingAttempt.status === "solved" || existingAttempt.status === "failed")) {
      const freshParticipant = await EventParticipantModel.findOne({ eventId, userId });
      return res.json(buildIdempotentAttemptResponse(existingAttempt, freshParticipant));
    }

    if (!puzzle) {
      return res.status(404).json({
        success: false,
        message: "Puzzle not found",
      });
    }

    const calculateScore = (difficulty, time) => {
      let points = 10;
      if (difficulty === "medium") points = 20;
      if (difficulty === "hard") points = 30;
      if (time && time < 30) points += 5;
      return points;
    };

    const { isCorrect, scoreOverride } = validatePuzzleSolution(
      puzzle,
      solution,
      moveCount,
      moveHistory
    );

    const becamePlaying = participant.status === "JOINED";
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
        { competitionId: eventId, puzzleId, userId },
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
        const settled = await PuzzleAttemptModel.findOne({ competitionId: eventId, puzzleId, userId });
        const currentParticipant = await EventParticipantModel.findOne({ eventId, userId });
        return res.json(buildIdempotentAttemptResponse(settled, currentParticipant));
      }

      const updatedParticipant = await EventParticipantModel.findOneAndUpdate(
        { eventId, userId },
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
        { new: true }
      );

      const responsePayload = {
        success      : true,
        isCorrect    : true,
        scoreEarned,
        totalScore   : updatedParticipant.score,
        puzzlesSolved: updatedParticipant.puzzlesSolved,
        puzzleStatus : "solved",
        message      : solveMessage,
        isHalfScore  : scoreOverride !== null,
      };

      res.json(responsePayload);

      setImmediate(async () => {
        try {
          await upsertEventLeaderboardEntry(eventId, {
            userId       : updatedParticipant.userId.toString(),
            username     : updatedParticipant.username,
            score        : updatedParticipant.score        || 0,
            puzzlesSolved: updatedParticipant.puzzlesSolved || 0,
            timeSpent    : updatedParticipant.timeSpent     || 0,
            status       : updatedParticipant.status        || "PLAYING",
            submittedAt  : updatedParticipant.submittedAt   || null,
          });
        } catch (redisError) {
          console.error("[Event Leaderboard] Redis upsert error in submitPuzzleSolution:", redisError);
        }

        io.to(`event_${eventId}`).emit("eventLiveScoreUpdate", {
          userId       : updatedParticipant.userId,
          username     : updatedParticipant.username,
          score        : updatedParticipant.score,
          puzzlesSolved: updatedParticipant.puzzlesSolved,
          timeSpent    : updatedParticipant.timeSpent,
          totalSolveTime: updatedParticipant.timeSpent,
          status       : updatedParticipant.status,
        });

        if (becamePlaying) {
          io.to(`event_${eventId}`).emit("eventPlayer-progress", {
            userId,
            participantState: "PLAYING",
          });
        }

        emitEventLeaderboardUpdateDebounced(eventId);
      });

      return;
    }

    // Incorrect solution
    const failedAttempt = await upsertTerminalAttempt(
      { competitionId: eventId, puzzleId, userId },
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
      const settled = await PuzzleAttemptModel.findOne({ competitionId: eventId, puzzleId, userId });
      const currentParticipant = await EventParticipantModel.findOne({ eventId, userId });
      return res.json(buildIdempotentAttemptResponse(settled, currentParticipant));
    }

    const updatedParticipant = await EventParticipantModel.findOneAndUpdate(
      { eventId, userId },
      {
        $inc: { timeSpent: puzzleTimeIncrement },
        $set: {
          lastActivity: new Date(),
          ...(becamePlaying ? { status: "PLAYING" } : {}),
        },
      },
      { new: true }
    );

    const failPayload = {
      success      : false,
      isCorrect    : false,
      scoreEarned  : 0,
      totalScore   : updatedParticipant.score,
      puzzlesSolved: updatedParticipant.puzzlesSolved,
      puzzleStatus : "failed",
      message      : "Incorrect solution.",
    };

    res.json(failPayload);

    setImmediate(async () => {
      try {
        await upsertEventLeaderboardEntry(eventId, {
          userId       : updatedParticipant.userId.toString(),
          username     : updatedParticipant.username,
          score        : updatedParticipant.score        || 0,
          puzzlesSolved: updatedParticipant.puzzlesSolved || 0,
          timeSpent    : updatedParticipant.timeSpent     || 0,
          status       : updatedParticipant.status        || "PLAYING",
          submittedAt  : updatedParticipant.submittedAt   || null,
        });
      } catch (redisError) {
        console.error("[Event Leaderboard] Redis upsert error on wrong answer:", redisError);
      }

      if (becamePlaying) {
        io.to(`event_${eventId}`).emit("eventPlayer-progress", {
          userId,
          participantState: "PLAYING",
        });
      }

      emitEventLeaderboardUpdateDebounced(eventId);
    });

    return;
  } catch (error) {
    console.error("[Controller] Event Puzzle submission error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during submission",
    });
  }
};

// Get live leaderboard for event
export const getLiveEventLeaderboard = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user?._id;

    const event = await EventModel.findById(eventId).select("name status startTime endTime puzzles chapters entryFeeType entryFeeAmount").lean();
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const [leaderboard, participant] = await Promise.all([
      getCurrentEventLeaderboard(eventId),
      userId ? EventParticipantModel.findOne({ eventId, userId }).select("status isApproved").lean() : null,
    ]);

    const participantState = participant ? participant.status : "NOT_JOINED";
    const isApproved = participant ? participant.isApproved : false;

    res.json({
      success: true,
      event: {
        id: event._id,
        name: event.name,
        status: event.status,
        startTime: event.startTime,
        endTime: event.endTime,
        puzzles: event.puzzles || [],
        chapters: event.chapters || [],
        totalPuzzles: event.puzzles?.length || 0,
        entryFeeType: event.entryFeeType || "free",
        entryFeeAmount: event.entryFeeAmount || 0,
      },
      eventState: event.status,
      participantState,
      isApproved,
      leaderboard,
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error("Error fetching live event leaderboard:", error);
    res.status(500).json({ success: false, message: "Failed to fetch leaderboard" });
  }
};

// Get event puzzles for participants
export const getEventPuzzles = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    const event = await EventModel.findById(eventId)
      .select("name status startTime endTime puzzles chapters")
      .lean();

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    let participant = await EventParticipantModel.findOne({ eventId, userId, isApproved: true }).lean();

    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'Not an approved participant in this event'
      });
    }

    const puzzleIds = (event.puzzles || []).map((id) => id.toString());

    const [puzzles, puzzleAttempts] = await Promise.all([
      PuzzleModel.find({ _id: { $in: puzzleIds } })
        .select(PUZZLE_LIVE_SELECT)
        .lean(),
      PuzzleAttemptModel.find({ competitionId: eventId, userId })
        .select("puzzleId status scoreEarned timeSpent completedAt boardPosition moveHistory isLocked")
        .lean(),
    ]);

    primePuzzlesForValidation(puzzles);

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

    const puzzlesWithStatus = puzzles.map(puzzle => {
      const puzzleId = puzzle._id.toString();
      const attemptData = attemptsMap.get(puzzleId);

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
        status,
        isSolved,
        isFailed,
        isLocked,
        solvedData: attemptData || null,
        boardPosition: attemptData?.boardPosition || null,
        moveHistory: attemptData?.moveHistory || []
      };
    });

    res.json({
      success: true,
      event: {
        id: event._id,
        name: event.name,
        status: event.status,
        startTime: event.startTime,
        endTime: event.endTime,
        totalPuzzles: puzzleIds.length,
        chapters: event.chapters || []
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
    console.error('Error fetching event puzzles:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch event puzzles' });
  }
};

// Check active participation for user in events
export const getActiveEventParticipation = async (req, res) => {
  try {
    const userId = req.user._id;
    const activeParticipant = await EventParticipantModel.findOne({
      userId,
      status: { $in: ["JOINED", "PLAYING"] },
      isApproved: true
    }).lean();

    if (!activeParticipant) {
      return res.json({ success: true, active: false });
    }

    const event = await EventModel.findById(activeParticipant.eventId)
      .select("name startTime endTime status")
      .lean();

    if (!event || event.status === "ENDED") {
      return res.json({ success: true, active: false });
    }

    res.json({
      success: true,
      active: true,
      participation: activeParticipant,
      event
    });
  } catch (error) {
    console.error("Error checking active participation:", error);
    res.status(500).json({ success: false, message: "Server error checking participation" });
  }
};

export default {
  participateInEvent,
  submitEvent,
  submitEventPuzzleSolution,
  getLiveEventLeaderboard,
  getEventPuzzles,
  getActiveEventParticipation
};
