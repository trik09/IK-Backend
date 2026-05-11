import EventModel from "../models/EventSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import PuzzleSolutionModel from "../models/PuzzleSolutionSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import UserModel from "../models/UserSchema.js";
import { io } from "../index.js";
import redis from "../config/redis.js";

import {
  scheduleEventEnd,
  getCurrentEventLeaderboard,
  handleEventEnd,
  upsertEventLeaderboardEntry,
  addEventParticipantToLeaderboard,
  getIO,
  eventLeaderboardKey,
  redisScore
} from "../utils/socketEventHandlers.js";

// Participate in live event (Lobby + Spectator view)
export const participateInEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    const event = await EventModel.findById(eventId)
      .select("name description startTime endTime duration status accessCode maxParticipants puzzles chapters")
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

        const leaderboard = await getCurrentEventLeaderboard(eventId);
        io.to(roomName).emit("eventLeaderboardUpdate", leaderboard);
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

    const participant = await EventParticipantModel.findOne({
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

    const submittedAt = new Date();
    participant.submittedAt = submittedAt;
    participant.isActive    = false;
    participant.isSubmitted = true;
    participant.status      = "SUBMITTED";

    const effectiveStart = (() => {
      const start = event.startTime instanceof Date ? event.startTime : new Date(event.startTime);
      return participant.joinedAt && participant.joinedAt > start ? participant.joinedAt : start;
    })();

    if (effectiveStart) {
      const elapsedMs = submittedAt.getTime() - effectiveStart.getTime();
      if (elapsedMs > 0) {
        participant.timeSpent = Math.floor(elapsedMs / 1000);
      }
    }

    await participant.save();

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
    getCurrentEventLeaderboard(eventId)
      .then((updatedLeaderboard) => {
        io.to(roomName).emit("eventLeaderboardUpdate", updatedLeaderboard);
      })
      .catch((err) => console.error("[Event Leaderboard] Submit leaderboard broadcast error:", err));

    io.to(roomName).emit("eventParticipantSubmitted", {
      username     : participant.username,
      score        : participant.score,
      puzzlesSolved: participant.puzzlesSolved,
      timeSpent    : participant.timeSpent,
    });

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
    const { solution, timeSpent, boardPosition, moveHistory } = req.body;
    const userId = req.user._id;

    const event = await EventModel.findById(eventId);
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

    const participant = await EventParticipantModel.findOne({
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

    if (participant.status === "SUBMITTED") {
      return res.status(400).json({
        success: false,
        message: "You have already submitted the event",
      });
    }

    const existingAttempt = await PuzzleAttemptModel.findOne({
      competitionId: eventId, // reuse attempt model, but competitionId points to eventId
      puzzleId,
      userId,
    });

    if (existingAttempt && (existingAttempt.status === "solved" || existingAttempt.status === "failed")) {
      return res.status(400).json({
        success    : false,
        message    : `Puzzle already ${existingAttempt.status}`,
        puzzleStatus: existingAttempt.status,
      });
    }

    const puzzle = await PuzzleModel.findById(puzzleId);
    if (!puzzle) {
      return res.status(404).json({
        success: false,
        message: "Puzzle not found",
      });
    }

    // Internal simple validation
    const validatePuzzleSolution = (p, sol) => {
      return JSON.stringify(sol) === JSON.stringify(p.solutionMoves);
    };

    const calculateScore = (difficulty, time) => {
      let points = 10;
      if (difficulty === "medium") points = 20;
      if (difficulty === "hard") points = 30;
      if (time && time < 30) points += 5;
      return points;
    };

    const isCorrect = validatePuzzleSolution(puzzle, solution);

    if (participant.status === "JOINED") {
      participant.status = "PLAYING";
      await participant.save();

      io.to(`event_${eventId}`).emit("eventPlayer-progress", {
        userId,
        participantState: "PLAYING",
      });
    }

    const effectiveStart = new Date(
      Math.max(
        new Date(event.startTime).getTime(),
        new Date(participant.joinedAt || new Date()).getTime()
      )
    ).getTime();

    const currentTotalTime = Math.max(0, Math.floor((Date.now() - effectiveStart) / 1000));

    if (isCorrect) {
      const scoreEarned = calculateScore(puzzle.difficulty, timeSpent);

      await PuzzleAttemptModel.findOneAndUpdate(
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
        },
        { upsert: true, new: true }
      );

      await new PuzzleSolutionModel({
        competitionId: eventId,
        puzzleId,
        userId,
        solution,
        timeSpent,
        scoreEarned,
        isCorrect: true,
        solvedAt : new Date(),
      }).save();

      const updatedParticipant = await EventParticipantModel.findOneAndUpdate(
        { eventId, userId },
        {
          $inc: { score: scoreEarned, puzzlesSolved: 1 },
          $set: { timeSpent: currentTotalTime, lastActivity: new Date() },
        },
        { new: true }
      );

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

      getCurrentEventLeaderboard(eventId)
        .then((leaderboard) => {
          io.to(`event_${eventId}`).emit("eventLeaderboardUpdate", leaderboard);
        })
        .catch((err) => console.error("[Event Leaderboard] Puzzle solve broadcast error:", err));

      io.to(`event_${eventId}`).emit("eventLiveScoreUpdate", {
        userId       : updatedParticipant.userId,
        username     : updatedParticipant.username,
        score        : updatedParticipant.score,
        puzzlesSolved: updatedParticipant.puzzlesSolved,
        timeSpent    : updatedParticipant.timeSpent,
        status       : updatedParticipant.status,
      });

      return res.json({
        success      : true,
        isCorrect    : true,
        scoreEarned,
        totalScore   : updatedParticipant.score,
        puzzlesSolved: updatedParticipant.puzzlesSolved,
        puzzleStatus : "solved",
        message      : "Puzzle solved successfully!",
      });
    }

    // Incorrect solution
    await PuzzleAttemptModel.findOneAndUpdate(
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
      },
      { upsert: true, new: true }
    );

    const updatedParticipant = await EventParticipantModel.findOneAndUpdate(
      { eventId, userId },
      {
        $set: { timeSpent: currentTotalTime, lastActivity: new Date() },
      },
      { new: true }
    );

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

    const event = await EventModel.findById(eventId).select("name status startTime endTime puzzles chapters").lean();
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

    const event = await EventModel.findById(eventId).populate('puzzles');
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const participant = await EventParticipantModel.findOne({ eventId, userId, isApproved: true });
    if (!participant) {
      return res.status(403).json({
        success: false,
        message: 'Not an approved participant in this event'
      });
    }

    const puzzleAttempts = await PuzzleAttemptModel.find({
      competitionId: eventId, // reuse attempt model, map competitionId to eventId
      userId
    }).select('puzzleId status scoreEarned timeSpent completedAt boardPosition moveHistory isLocked');

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

    const solvedPuzzles = await PuzzleSolutionModel.find({
      competitionId: eventId,
      userId,
      isCorrect: true
    }).select('puzzleId scoreEarned timeSpent solvedAt');

    const solvedMap = new Map();
    solvedPuzzles.forEach(solution => {
      solvedMap.set(solution.puzzleId.toString(), {
        scoreEarned: solution.scoreEarned,
        timeSpent: solution.timeSpent,
        solvedAt: solution.solvedAt
      });
    });

    const puzzlesWithStatus = event.puzzles.map(puzzle => {
      const puzzleId = puzzle._id.toString();
      const attemptData = attemptsMap.get(puzzleId);
      const solvedData = solvedMap.get(puzzleId);

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
        status,
        isSolved,
        isFailed,
        isLocked,
        solvedData: attemptData || solvedData || null,
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
        totalPuzzles: event.puzzles.length,
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
