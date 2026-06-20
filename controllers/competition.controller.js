import CompetitionModel from "../models/CompetitionSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import ParticipantModel from "../models/ParticipantSchema.js";
import { addParticipantToLeaderboard } from "../utils/socketHandlers.js";
import EventRoundModel from "../models/EventRoundSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import {
  getPuzzleIdsFromCompetition,
  incrementPuzzleUsageCounts,
  decrementPuzzleUsageCounts,
  syncPuzzleUsageCounts,
} from "../utils/puzzleUsageCount.js";
import { validatePuzzleSolution } from "../utils/puzzleValidationUtils.js";


// Create a new competition
export const createCompetition = async (req, res) => {
  try {
    const { name, description, startTime, duration, puzzles, maxParticipants, accessCode, chapters } =
      req.body;
    console.log(req.body);

    // Validate required fields
    if (!name || !startTime || !duration) {
      return res.status(400).json({
        message: "Name, start time, and duration are required",
      });
    }

    // Calculate endTime based on startTime + duration (in minutes)
    const start = new Date(startTime);
    const durationInMinutes = parseInt(duration);
    const end = new Date(start.getTime() + durationInMinutes * 60 * 1000);

    // Validate puzzles exist (deduplicate first to avoid storing duplicates)
    if (puzzles && puzzles.length > 0) {
      const uniquePuzzles = [...new Set(puzzles.map(String))];
      const existingPuzzles = await PuzzleModel.find({ _id: { $in: uniquePuzzles } });
      if (existingPuzzles.length !== uniquePuzzles.length) {
        return res.status(400).json({
          message: "Some puzzles do not exist",
        });
      }
    }

    // Determine status based on start time (use uppercase to match schema enum)
    const now = new Date();

    let status = "UPCOMING";
    let isActive = false;

    if (now >= start && now <= end) {
      status = "LIVE";
      isActive = true;
    } else if (now > end) {
      status = "ENDED";
      isActive = false;
    }

    // Derive puzzles from chapters if chapters are provided — chapters are the
    // source of truth from the admin puzzle builder. This keeps competition.puzzles
    // in sync so the frontend and backend always see the same count.
    let resolvedPuzzles = puzzles ? [...new Set(puzzles.map(String))] : [];
    if (chapters && Array.isArray(chapters) && chapters.length > 0) {
      const fromChapters = [...new Set(
        chapters.flatMap(ch => ch.puzzleIds || []).map(String)
      )];
      // If chapters were provided, they are authoritative
      if (fromChapters.length > 0) resolvedPuzzles = fromChapters;
    }

    const competition = await CompetitionModel.create({
      name,
      description,
      startTime,
      endTime: end,
      duration: durationInMinutes,
      puzzles: resolvedPuzzles,
      chapters: chapters || [],
      maxParticipants,
      status,
      isActive,
      accessCode,
      createdBy: req.admin._id,
    });

    await incrementPuzzleUsageCounts(getPuzzleIdsFromCompetition(competition));

    res.status(201).json({
      message: "Competition created successfully",
      competition,
    });
  } catch (error) {
    console.error("Error creating competition:", error);
    res.status(500).json({
      message: "Failed to create competition",
      error: error.message,
    });
  }
};

// Get all competitions
export const getCompetitions = async (req, res) => {
  try {
    const { status, isActive, page = 1, limit = 10, startBefore } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const now = new Date();

    const query = {};

    if (status) {
      const s = status.toUpperCase();
      if (s === "LIVE") {
        query.endTime = { $gt: now };
        query.$or = [
          // Only LIVE competitions that haven't ended yet
          { status: "LIVE", endTime: { $gt: now } },
          // Catch stale UPCOMING competitions that have already started but not ended
          { status: "UPCOMING", startTime: { $lte: now }, endTime: { $gt: now } },
        ];
      } else if (s === "UPCOMING") {
        query.status = "UPCOMING";
        query.startTime = { $gt: now };
        if (startBefore) {
          query.startTime.$lte = new Date(startBefore);
        }
      } else if (s === "ENDED") {
        query.$or = [
          { status: "ENDED" },
          { endTime: { $lte: now } }
        ];
      } else {
        query.status = s;
      }
    }

    if (isActive !== undefined) query.isActive = isActive === "true";

    const skip = (pageNum - 1) * limitNum;

    const resolvedStatus = status ? status.toUpperCase() : null;
    const sortOrder =
      resolvedStatus === "ENDED" ? { startTime: -1 } : { startTime: 1 };

    // ── Single query: no populate, no participants array, no aggregate ────────
    // puzzles is selected only for its length (puzzleCount), not its content.
    // participants array is excluded — count comes from a $facet in the same pipeline.
    const [competitions, total] = await Promise.all([
      CompetitionModel.find(query)
        .select(
          "name description status startTime endTime duration puzzles maxParticipants createdAt"
          // NOTE: 'participants' intentionally excluded — it's a large legacy array
          // we no longer need here. Counts come from ParticipantModel below.
        )
        // NO .populate("puzzles") — we only need the count, not the full documents
        .sort(sortOrder)
        .skip(skip)
        .limit(limitNum)
        .lean(),

      CompetitionModel.countDocuments(query),
    ]);

    // Async: promote stale UPCOMING→LIVE in background (non-blocking)
    const staleUpcoming = competitions.filter(
      (c) => c.status === "UPCOMING" && new Date(c.startTime) <= now && new Date(c.endTime) > now
    );
    if (staleUpcoming.length) {
      CompetitionModel.updateMany(
        { _id: { $in: staleUpcoming.map((c) => c._id) } },
        { status: "LIVE", isActive: true }
      ).catch(() => { });
    }

    // ── Single aggregate for participant counts across all competitions ───────
    // Replaces a separate aggregate call — runs in parallel with countDocuments above.
    const competitionIds = competitions.map((c) => c._id);
    const participantCounts = competitionIds.length
      ? await ParticipantModel.aggregate([
        { $match: { competitionId: { $in: competitionIds } } },
        { $group: { _id: "$competitionId", count: { $sum: 1 } } },
      ])
      : [];
    const countMap = new Map(participantCounts.map((p) => [p._id.toString(), p.count]));

    // Fetch all event rounds that contain these competitions to identify event association
    const eventRounds = competitionIds.length
      ? await EventRoundModel.find({ competitionId: { $in: competitionIds } }).select("competitionId eventId").lean()
      : [];
    
    // Create a map: competitionId -> eventId
    const compEventMap = {};
    eventRounds.forEach(r => {
      if (r.competitionId && r.eventId) {
        compEventMap[r.competitionId.toString()] = r.eventId.toString();
      }
    });

    // Find all approved registrations of req.user for these events
    const eventIds = [...new Set(eventRounds.map(r => r.eventId.toString()))];
    const userEventRegs = (req.user && eventIds.length)
      ? await EventParticipantModel.find({
          eventId: { $in: eventIds },
          userId: req.user._id,
          isApproved: true
        }).select("eventId").lean()
      : [];
    const approvedEventIds = new Set(userEventRegs.map(r => r.eventId.toString()));

    const enriched = competitions.map((c) => {
      let effectiveStatus = c.status;
      const start = new Date(c.startTime);
      const end = new Date(c.endTime);
      if (c.status === "UPCOMING" && start <= now && end > now) {
        effectiveStatus = "LIVE";
      }

      const eventId = compEventMap[c._id.toString()] || null;
      const isEventOnly = !!eventId;
      const isUserEventApproved = isEventOnly ? approvedEventIds.has(eventId) : true;

      return {
        _id: c._id,
        name: c.name,
        description: c.description,
        status: effectiveStatus,
        startTime: c.startTime,
        endTime: c.endTime,
        duration: c.duration,
        maxParticipants: c.maxParticipants,
        createdAt: c.createdAt,
        puzzleCount: (c.puzzles || []).length,   // count only, no puzzle data
        participantCount: countMap.get(c._id.toString()) ?? 0,
        eventId,
        isEventOnly,
        isUserEventApproved,
      };
    });


    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        current: pageNum,
        total: Math.ceil(total / limitNum),
        count: competitions.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Error fetching competitions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch competitions",
    });
  }
};


// Get puzzles with advanced filtering for competition creation
export const getPuzzlesForCompetition = async (req, res) => {
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
      sortBy = 'competitionUsageCount',
      sortOrder = 'asc'
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

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const skip = (pageNum - 1) * limitNum;

    const allowedSortFields = [
      'createdAt',
      'title',
      'level',
      'rating',
      'difficulty',
      'category',
      'competitionUsageCount',
    ];
    const resolvedSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : 'competitionUsageCount';
    const sortDir = sortOrder === 'desc' ? -1 : 1;
    const sortStage =
      resolvedSortBy === 'competitionUsageCount'
        ? { competitionUsageCount: sortDir, createdAt: -1 }
        : { [resolvedSortBy]: sortDir };

    const pipeline = [
      { $match: query },
      {
        $addFields: {
          competitionUsageCount: { $ifNull: ['$competitionUsageCount', 0] },
        },
      },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limitNum },
      {
        $lookup: {
          from: 'admins',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdByDoc',
        },
      },
      {
        $addFields: {
          createdBy: {
            $let: {
              vars: { admin: { $arrayElemAt: ['$createdByDoc', 0] } },
              in: {
                _id: '$$admin._id',
                name: '$$admin.name',
                email: '$$admin.email',
              },
            },
          },
        },
      },
      { $project: { createdByDoc: 0 } },
    ];

    const [puzzles, total, categories, difficulties, types, levels, ratings] =
      await Promise.all([
        PuzzleModel.aggregate(pipeline),
        PuzzleModel.countDocuments(query),
        PuzzleModel.distinct('category'),
        PuzzleModel.distinct('difficulty'),
        PuzzleModel.distinct('type'),
        PuzzleModel.distinct('level'),
        PuzzleModel.distinct('rating'),
      ]);

    res.status(200).json({
      success: true,
      data: puzzles,
      pagination: {
        current: pageNum,
        total: Math.max(1, Math.ceil(total / limitNum)),
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
    console.error("Error fetching puzzles:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch puzzles",
    });
  }
};

// Get competition by ID
export const getCompetitionById = async (req, res) => {
  try {
    const { id } = req.params;

    const competition = await CompetitionModel.findById(id)
      .populate("puzzles")
      .populate("createdBy", "name email")
      .populate("participants.user", "name email");

    if (!competition) {
      return res.status(404).json({
        success: false,
        message: "Competition not found",
      });
    }

    // Apply time-based status correction so the frontend always gets the
    // effective status, not a stale DB value.
    const now = new Date();
    const start = new Date(competition.startTime);
    const end = new Date(competition.endTime);

    if (competition.status === "UPCOMING" && now >= start && now <= end) {
      competition.status = "LIVE";
      // Fix DB asynchronously — don't block the response
      CompetitionModel.updateOne(
        { _id: id },
        { status: "LIVE", isActive: true }
      ).catch(() => { });
    } else if (competition.status !== "ENDED" && now > end) {
      competition.status = "ENDED";
      CompetitionModel.updateOne(
        { _id: id },
        { status: "ENDED", isActive: false }
      ).catch(() => { });
    }

    res.status(200).json({
      success: true,
      data: competition,
    });
  } catch (error) {
    console.error("Error fetching competition:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch competition",
    });
  }
};


// Update competition
export const updateCompetition = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // ── BOTTLENECK 1 FIX: use findById with lean() just to check existence,
    // then use findByIdAndUpdate instead of load→mutate→save.
    // competition.save() on a document with a large embedded participants[]
    // array re-validates and re-writes the entire document — very slow.
    const competition = await CompetitionModel.findById(id)
      .select('_id startTime endTime duration status accessCode puzzles chapters')
      .lean();

    if (!competition) {
      return res.status(404).json({ message: "Competition not found" });
    }

    const previousPuzzleIds = getPuzzleIdsFromCompetition(competition);
    const puzzlesWillChange =
      updates.puzzles !== undefined || updates.chapters !== undefined;

    // ── Sync puzzles[] from chapters FIRST (chapters are source of truth) ──────
    // Must happen before puzzle validation so we validate the correct IDs.
    if (updates.chapters !== undefined && Array.isArray(updates.chapters)) {
      const allPuzzleIds = updates.chapters.flatMap(ch => ch.puzzleIds || []);
      updates.puzzles = [...new Set(allPuzzleIds.map(String))];
    }

    // ── Puzzle validation — only query _id, not full docs ──────────────────
    // Skip validation when chapters are provided (IDs came from DB, they're valid).
    // Only validate if puzzles were sent without chapters (legacy path).
    if (updates.puzzles !== undefined && updates.chapters === undefined) {
      if (Array.isArray(updates.puzzles) && updates.puzzles.length > 0) {
        updates.puzzles = [...new Set(updates.puzzles.map(String))];

        const existingCount = await PuzzleModel.countDocuments({
          _id: { $in: updates.puzzles },
        });

        if (existingCount !== updates.puzzles.length) {
          const foundDocs = await PuzzleModel.find(
            { _id: { $in: updates.puzzles } },
            { _id: 1 }
          ).lean();
          const foundIds = new Set(foundDocs.map(d => d._id.toString()));
          const missingIds = updates.puzzles.filter(id => !foundIds.has(id));
          console.error('[updateCompetition] Missing puzzle IDs:', missingIds);

          return res.status(400).json({
            message: "Some puzzles do not exist",
            missingIds,
          });
        }
      }
    }

    // ── Compute endTime if startTime or duration changed ─────────────────────
    if (updates.startTime || updates.duration) {
      const start = new Date(updates.startTime || competition.startTime);
      const durationInMinutes =
        updates.duration !== undefined && updates.duration !== ""
          ? parseInt(updates.duration)
          : competition.duration;

      if (isNaN(durationInMinutes)) {
        return res.status(400).json({ message: "Invalid duration value" });
      }

      updates.duration = durationInMinutes;
      updates.endTime = new Date(start.getTime() + durationInMinutes * 60 * 1000);
    }

    // ── Recompute status from times ───────────────────────────────────────────
    if (updates.startTime || updates.endTime || updates.duration) {
      const now = new Date();
      const start = new Date(updates.startTime || competition.startTime);
      const end = new Date(updates.endTime || competition.endTime);

      if (now >= start && now <= end) {
        updates.status = "LIVE";
        updates.isActive = true;
      } else if (now > end) {
        updates.status = "ENDED";
        updates.isActive = false;
      } else {
        updates.status = "UPCOMING";
        updates.isActive = false;
      }
    }

    // ── Handle accessCode unset ───────────────────────────────────────────────
    if (updates.accessCode === "" || updates.accessCode === null) {
      updates.accessCode = undefined;
    }

    // ── Build the $set payload — only allowed fields ──────────────────────────
    const allowedFields = [
      'name', 'description', 'startTime', 'endTime', 'duration',
      'puzzles', 'chapters', 'maxParticipants', 'status', 'isActive',
      'accessCode', 'updatedAt',
    ];
    const $set = { updatedAt: new Date() };
    const $unset = {};

    allowedFields.forEach(field => {
      if (field === 'updatedAt') return; // already set above
      if (updates[field] === undefined) return;

      if (field === 'maxParticipants') {
        if (updates[field] === '' || updates[field] === null) {
          $unset[field] = "";          // remove the field entirely
        } else {
          $set[field] = parseInt(updates[field]) || undefined;
        }
      } else if (field === 'accessCode' && updates[field] === undefined) {
        $unset[field] = "";
      } else {
        $set[field] = updates[field];
      }
    });

    // ── BOTTLENECK 3 FIX: use findByIdAndUpdate instead of .save() ───────────
    // .save() re-validates and rewrites the ENTIRE document including the large
    // legacy participants[] array. findByIdAndUpdate only touches the fields
    // in $set/$unset — much faster and avoids Mongoose validation overhead.
    const updateOp = { $set };
    if (Object.keys($unset).length) updateOp.$unset = $unset;

    const updated = await CompetitionModel.findByIdAndUpdate(
      id,
      updateOp,
      {
        new: true,
        runValidators: true,
        projection: {
          name: 1, description: 1, status: 1, startTime: 1, endTime: 1,
          duration: 1, maxParticipants: 1, accessCode: 1, isActive: 1,
          updatedAt: 1, createdAt: 1, puzzles: 1, chapters: 1,
          puzzleCount: { $size: { $ifNull: ["$puzzles", []] } },
        },
      }
    );

    if (puzzlesWillChange && updated) {
      await syncPuzzleUsageCounts(
        previousPuzzleIds,
        getPuzzleIdsFromCompetition(updated)
      );
    }

    res.status(200).json({
      message: "Competition updated successfully",
      competition: updated,
    });
  } catch (error) {
    console.error("Error updating competition:", error);

    // Surface the actual Mongoose validation error to help debugging
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({
        message: "Validation failed",
        errors: messages,
      });
    }

    res.status(500).json({
      message: "Failed to update competition",
      error: error.message || "Unknown error occurred",
    });
  }
};

// Delete competition
export const deleteCompetition = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Deleting competition:", id);

    const competition = await CompetitionModel.findByIdAndDelete(id);

    //console.log("Competition found:", !!competition);

    if (!competition) {
      return res.status(404).json({ message: "Competition not found" });
    }

    const puzzleIds = getPuzzleIdsFromCompetition(competition);

    //console.log("Puzzle IDs:", puzzleIds);

    await decrementPuzzleUsageCounts(puzzleIds);

   // console.log("Usage counts updated");

    res.status(200).json({
      message: "Competition deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to delete competition",
      error: error.message,
    });
  }
};

// Join competition (for users)
export const joinCompetition = async (req, res) => {
  try {
    const { id } = req.params;
    const { accessCode } = req.body;
    console.log(accessCode);
    const userId = req.user._id;

    const competition = await CompetitionModel.findById(id);
    if (!competition) {
      return res.status(404).json({ message: "Competition not found" });
    }

    // Check if competition belongs to an Event
    const eventRound = await EventRoundModel.findOne({ competitionId: id }).select("eventId").lean();
    if (eventRound) {
      // It is part of an event. Check if the user is registered and approved
      const isApproved = await EventParticipantModel.findOne({
        eventId: eventRound.eventId,
        userId,
        isApproved: true
      }).lean();

      if (!isApproved) {
        return res.status(403).json({
          message: "This tournament is restricted. You must register and get approved for the corresponding event first."
        });
      }
    }


    // 🔄 Recalculate active status based on current time to avoid stale `isActive`
    const now = new Date();
    const start = new Date(competition.startTime);
    const end = new Date(competition.endTime);

    const isWithinWindow = now >= start && now <= end;

    if (!isWithinWindow) {
      return res.status(400).json({ message: "Competition is not active" });
    }

    // Ensure stored status flags are in sync when user joins
    if (competition.status !== "LIVE" || !competition.isActive) {
      competition.status = "LIVE";
      competition.isActive = true;
    }

    // Check Access Code
    if (competition.accessCode && competition.accessCode !== accessCode) {
      return res.status(403).json({ message: "Invalid access code", requireCode: true });
    }

    // Check if already joined
    const alreadyJoined = competition.participants.some(
      (p) => p.user.toString() === userId.toString()
    );

    if (alreadyJoined) {
      return res
        .status(400)
        .json({ message: "Already joined this competition" });
    }

    // Check max participants
    if (
      competition.maxParticipants &&
      competition.participants.length >= competition.maxParticipants
    ) {
      return res.status(400).json({ message: "Competition is full" });
    }

    // Ensure ParticipantModel entry exists as well (Unified system)
    let participant = await ParticipantModel.findOne({ competitionId: id, userId });

    if (!participant) {
      participant = await ParticipantModel.create({
        competitionId: id,
        userId,
        username: req.user.username || req.user.name,
        status: "JOINED",
        joinedAt: new Date(),
        score: 0,
        puzzlesSolved: 0,
        timeSpent: 0,
      });

      // Sync to Redis and Broadcast
      setImmediate(async () => {
        try {
          await addParticipantToLeaderboard(id, participant);
        } catch (err) {
          console.error("Redis sync error in joinCompetition:", err);
        }
      });
    }

    competition.participants.push({
      user: userId,
      score: 0,
      ENDEDPuzzles: [],
      joinedAt: new Date(),
    });

    await competition.save();

    res.status(200).json({
      message: "Joined competition successfully",
      competition,
    });
  } catch (error) {
    console.error("Error joining competition:", error);
    res.status(500).json({ message: "Failed to join competition" });
  }
};

// Submit puzzle solution in competition
export const submitSolution = async (req, res) => {
  try {
    const { id, puzzleId } = req.params;
    const { moves, timeTaken, moveHistory } = req.body;
    const userId = req.user._id;

    const competition = await CompetitionModel.findById(id).populate("puzzles");
    if (!competition) {
      return res.status(404).json({ message: "Competition not found" });
    }

    const participant = competition.participants.find(
      (p) => p.user.toString() === userId.toString()
    );

    if (!participant) {
      return res
        .status(400)
        .json({ message: "Not a participant in this competition" });
    }

    if (participant.ENDEDPuzzles.includes(puzzleId)) {
      return res.status(400).json({ message: "Puzzle already ENDED" });
    }

    const puzzle = competition.puzzles.find(
      (p) => p._id.toString() === puzzleId
    );
    if (!puzzle) {
      return res
        .status(400)
        .json({ message: "Puzzle not part of this competition" });
    }

    const submittedMoves = moveHistory?.length ? moveHistory : moves;
    const { isCorrect, scoreOverride } = validatePuzzleSolution(
      puzzle,
      submittedMoves,
      null,
      submittedMoves,
    );

    if (isCorrect) {
      participant.ENDEDPuzzles.push(puzzleId);

      let points = scoreOverride !== null ? scoreOverride : 10;
      if (scoreOverride === null) {
        if (puzzle.difficulty === "medium") points = 10;
        if (puzzle.difficulty === "hard") points = 5;
        if (timeTaken < 30) points += 5;
      }

      participant.score += points;

      await competition.save();

      res.status(200).json({
        message: "Solution correct!",
        points,
        totalScore: participant.score,
        isCorrect: true,
      });
    } else {
      res.status(400).json({ message: "Incorrect solution", isCorrect: false });
    }
  } catch (error) {
    console.error("Error submitting solution:", error);
    res.status(500).json({ message: "Failed to submit solution" });
  }
};

// Get leaderboard
export const getLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;

    const competition = await CompetitionModel.findById(id).populate(
      "participants.user",
      "name email"
    );

    if (!competition) {
      return res.status(404).json({ message: "Competition not found" });
    }

    // Sort participants by score
    const leaderboard = competition.participants
      .sort((a, b) => b.score - a.score)
      .map((p, index) => ({
        rank: index + 1,
        user: p.user,
        score: p.score,
        ENDEDPuzzles: p.ENDEDPuzzles.length,
        joinedAt: p.joinedAt,
      }));

    res.status(200).json({
      competition: {
        name: competition.name,
        status: competition.status,
      },
      leaderboard,
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ message: "Failed to fetch leaderboard" });
  }
};

export const getPuzzlesByIds = async (req, res) => {
  try {
    const { puzzleIds } = req.body;

    if (!puzzleIds || !Array.isArray(puzzleIds) || puzzleIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "puzzleIds array is required"
      });
    }

    const puzzles = await PuzzleModel.find({
      _id: { $in: puzzleIds }
    }).populate("createdBy", "name");

    const puzzlesWithUsage = puzzles.map((p) => ({
      ...p.toObject(),
      competitionUsageCount: p.competitionUsageCount || 0,
    }));

    res.status(200).json({
      success: true,
      data: puzzlesWithUsage
    });
  } catch (error) {
    console.error("Error fetching puzzles by IDs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch puzzles"
    });
  }
};

export default {
  createCompetition,
  getCompetitions,
  getCompetitionById,
  updateCompetition,
  deleteCompetition,
  joinCompetition,
  submitSolution,
  getLeaderboard,
  getPuzzlesForCompetition,
  getPuzzlesByIds
};
