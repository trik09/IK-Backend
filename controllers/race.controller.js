import mongoose from "mongoose";
import RaceModel from "../models/RaceSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import { getOrLoadRace, checkAndTriggerRaceLifecycle, getRaceIO } from "../utils/socketRaceHandlers.js";

/**
 * Admin: Get available puzzle categories with playable puzzle counts
 */
export const getPuzzleCategories = async (req, res) => {
  try {
    const categoryStats = await PuzzleModel.aggregate([
      {
        $match: {
          type: "normal",
          solutionMoves: { $exists: true, $ne: [] },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalPlayable = categoryStats.reduce((acc, curr) => acc + curr.count, 0);

    const formatted = categoryStats
      .filter((item) => item._id && item.count > 0)
      .map((item) => ({
        category: item._id,
        count: item.count,
      }));

    return res.status(200).json({
      success: true,
      totalPlayable,
      categories: formatted,
    });
  } catch (error) {
    console.error("[RaceController] getPuzzleCategories error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Admin: Create a new race
 */
export const createRace = async (req, res) => {
  try {
    const {
      name,
      description = "",
      startTime,
      duration = 90, // seconds
      countdownDuration = 10,
      category = "All",
      puzzleCount = 50,
      manualPuzzleIds = [],
    } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ success: false, error: "Race name is required" });
    }

    const start = startTime ? new Date(startTime) : new Date(Date.now() + 60 * 1000);
    const durationNum = Number(duration) || 90;
    const end = new Date(start.getTime() + durationNum * 1000);

    let selectedPuzzleIds = [];

    // 1. Add manual puzzle IDs if selected by admin
    if (Array.isArray(manualPuzzleIds) && manualPuzzleIds.length > 0) {
      selectedPuzzleIds = manualPuzzleIds.filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      );
    }

    // 2. Fetch random puzzles by category if random count is specified
    const randomNeeded = typeof puzzleCount !== "undefined" && puzzleCount !== null ? Number(puzzleCount) : 20;

    if (randomNeeded > 0) {
      const matchCriteria = {
        type: "normal",
        solutionMoves: { $exists: true, $ne: [] },
      };

      if (category && category !== "All") {
        // Flexible matching for variations (e.g. "mate in 1" vs "Mate in One")
        const regexStr = category.trim().replace(/1/g, "(1|one)").replace(/2/g, "(2|two)");
        matchCriteria.category = { $regex: new RegExp(`^${regexStr}$`, "i") };
      }

      // Avoid already manually selected puzzles
      if (selectedPuzzleIds.length > 0) {
        matchCriteria._id = {
          $nin: selectedPuzzleIds.map((id) => new mongoose.Types.ObjectId(id)),
        };
      }

      // Check available playable puzzles in database
      const availableCount = await PuzzleModel.countDocuments(matchCriteria);

      // STRICT VALIDATION: If requested more puzzles than available, PREVENT creation!
      if (availableCount < randomNeeded) {
        return res.status(400).json({
          success: false,
          error: `Category "${category}" only has ${availableCount} playable puzzle${availableCount === 1 ? "" : "s"} available in database, but you requested ${randomNeeded}. Please enter ${availableCount} or fewer puzzles, or pick "All Categories".`,
          availableCount,
          requestedCount: randomNeeded,
        });
      }

      const randomPuzzles = await PuzzleModel.aggregate([
        { $match: matchCriteria },
        { $sample: { size: randomNeeded } },
        { $project: { _id: 1 } },
      ]);

      const sampledIds = randomPuzzles.map((p) => p._id.toString());
      selectedPuzzleIds = [...selectedPuzzleIds, ...sampledIds];
    }

    if (selectedPuzzleIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No puzzles selected. Please choose a category with available puzzles or select manual puzzles.",
      });
    }

    const targetDistanceNum = Number(req.body.targetDistance) || 500;

    const race = new RaceModel({
      name: name.trim(),
      description: description.trim(),
      startTime: start,
      endTime: end,
      duration: durationNum,
      countdownDuration: Number(countdownDuration) || 10,
      targetDistance: targetDistanceNum,
      category,
      puzzles: selectedPuzzleIds,
      status: start <= new Date() ? "LIVE" : "UPCOMING",
      createdBy: req.user?._id || null,
    });

    await race.save();

    // Populate and initialize in memory for socket lifecycle
    const savedRace = await RaceModel.findById(race._id).populate("puzzles");
    const raceState = await getOrLoadRace(race._id);
    if (raceState) {
      checkAndTriggerRaceLifecycle(raceState);
    }

    const io = getRaceIO();
    if (io) {
      io.emit("racesListChanged", { action: "create", raceId: race._id });
      io.emit("raceLobbyUpdate", {
        raceId: String(race._id),
        participantCount: 0,
        status: race.status,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Race created successfully",
      race: savedRace,
    });
  } catch (error) {
    console.error("[RaceController] createRace error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Admin: List all races
 */
export const getAdminRaces = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [races, total] = await Promise.all([
      RaceModel.find(query)
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      RaceModel.countDocuments(query),
    ]);

    const formattedRaces = races.map((r) => ({
      _id: r._id,
      name: r.name,
      description: r.description,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.duration,
      targetDistance: r.targetDistance || 500,
      status: r.status,
      category: r.category,
      puzzleCount: r.puzzles ? r.puzzles.length : 0,
      participantCount: r.participants ? r.participants.length : 0,
      createdAt: r.createdAt,
    }));

    return res.status(200).json({
      success: true,
      races: formattedRaces,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    console.error("[RaceController] getAdminRaces error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Admin: Delete race
 */
export const deleteRace = async (req, res) => {
  try {
    const { id } = req.params;
    const race = await RaceModel.findByIdAndDelete(id);
    if (!race) {
      return res.status(404).json({ success: false, error: "Race not found" });
    }

    const io = getRaceIO();
    if (io) {
      io.emit("racesListChanged", { action: "delete", raceId: id });
    }

    return res.status(200).json({ success: true, message: "Race deleted successfully" });
  } catch (error) {
    console.error("[RaceController] deleteRace error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Public / Student: List races (upcoming, live, recent)
 */
export const getPublicRaces = async (req, res) => {
  try {
    const now = new Date();
    // Update any past races status dynamically
    await RaceModel.updateMany(
      { endTime: { $lt: now }, status: { $ne: "ENDED" } },
      { $set: { status: "ENDED" } }
    );

    const races = await RaceModel.find()
      .sort({ startTime: -1 })
      .limit(30)
      .select("name description startTime endTime duration countdownDuration targetDistance status category puzzles participants")
      .lean();

    const formattedRaces = races.map((r) => ({
      _id: r._id,
      name: r.name,
      description: r.description,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.duration,
      targetDistance: r.targetDistance || 500,
      status: r.status,
      category: r.category,
      puzzleCount: r.puzzles?.length || 0,
      participantCount: r.participants?.length || 0,
    }));

    return res.status(200).json({
      success: true,
      races: formattedRaces,
    });
  } catch (error) {
    console.error("[RaceController] getPublicRaces error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Public / Student: Get race details by ID (With real-time rehydration & state restoration on refresh)
 */
export const getRaceById = async (req, res) => {
  try {
    const { id } = req.params;
    const race = await RaceModel.findById(id).populate("puzzles").lean();

    if (!race) {
      return res.status(404).json({ success: false, error: "Race not found" });
    }

    // Get live in-memory state if available
    const raceState = await getOrLoadRace(id);

    const now = Date.now();
    const startTimeMs = new Date(race.startTime).getTime();
    const endTimeMs = new Date(race.endTime).getTime();

    // Determine accurate live status
    let currentStatus = race.status;
    let secondsRemaining = race.duration || 90;
    let countdownRemaining = null;

    if (now >= endTimeMs || raceState?.status === "ENDED") {
      currentStatus = "ENDED";
      secondsRemaining = 0;
    } else if (now >= startTimeMs || raceState?.status === "LIVE") {
      currentStatus = "LIVE";
      secondsRemaining = Math.max(0, Math.round((endTimeMs - now) / 1000));
    } else {
      currentStatus = "UPCOMING";
      const diffToStart = startTimeMs - now;
      const countdownWindow = (race.countdownDuration || 10) * 1000;
      if (diffToStart <= countdownWindow) {
        countdownRemaining = Math.max(1, Math.ceil(diffToStart / 1000));
      } else if (raceState?.countdownRemaining) {
        countdownRemaining = raceState.countdownRemaining;
      }
    }

    // Merge live participant stats from in-memory raceState or MongoDB
    let mergedParticipants = (race.participants || []).map((p) => {
      const uId = String(p.user?._id || p.user);
      const liveP = raceState?.participants?.get(uId);
      return {
        user: p.user,
        userId: uId,
        username: liveP?.username || p.username || "Racer",
        name: liveP?.name || p.name || "",
        avatar: liveP?.avatar || p.avatar || null,
        vehicle: liveP?.vehicle || p.vehicle || { id: "supercar", name: "Supercar", color: "#ef4444" },
        meters: liveP ? liveP.meters : p.meters || 0,
        speed: liveP ? liveP.speed : p.speed || 0,
        combo: liveP ? liveP.combo : p.combo || 0,
        maxCombo: liveP ? liveP.maxCombo : p.maxCombo || 0,
        puzzlesSolved: liveP ? liveP.puzzlesSolved : p.puzzlesSolved || 0,
        mistakes: liveP ? liveP.mistakes : p.mistakes || 0,
        skipsUsed: liveP ? liveP.skipsUsed : p.skipsUsed || 0,
        currentPuzzleIndex: liveP ? liveP.currentPuzzleIndex : p.currentPuzzleIndex || 0,
      };
    });

    // If live memory has any participants not yet saved to DB
    if (raceState?.participants) {
      raceState.participants.forEach((liveP, uId) => {
        if (!mergedParticipants.some((p) => String(p.userId) === String(uId))) {
          mergedParticipants.push({
            user: liveP.userId,
            userId: liveP.userId,
            username: liveP.username || "Racer",
            name: liveP.name || "",
            avatar: liveP.avatar || null,
            vehicle: liveP.vehicle,
            meters: liveP.meters || 0,
            speed: liveP.speed || 0,
            combo: liveP.combo || 0,
            maxCombo: liveP.maxCombo || 0,
            puzzlesSolved: liveP.puzzlesSolved || 0,
            mistakes: liveP.mistakes || 0,
            skipsUsed: liveP.skipsUsed || 0,
            currentPuzzleIndex: liveP.currentPuzzleIndex || 0,
          });
        }
      });
    }

    const formattedPuzzles = (race.puzzles || []).map((p) => ({
      _id: p._id,
      id: p._id,
      title: p.title || "Puzzle",
      fen: p.fen,
      solutionMoves: p.solutionMoves || [],
      solution: p.solutionMoves || [],
      alternativeSolutions: p.alternativeSolutions || [],
      type: p.type || "normal",
      puzzleType: p.type || "normal",
      firstMoveBy: p.firstMoveBy || "w",
      difficulty: p.difficulty || "medium",
      category: p.category || "Tactics",
      rating: p.rating || 400,
    }));

    return res.status(200).json({
      success: true,
      race: {
        _id: race._id,
        name: race.name,
        description: race.description,
        startTime: race.startTime,
        endTime: race.endTime,
        duration: race.duration,
        countdownDuration: race.countdownDuration || 10,
        targetDistance: race.targetDistance || 500,
        status: currentStatus,
        secondsRemaining,
        timeRemaining: secondsRemaining,
        countdownRemaining,
        category: race.category,
        puzzles: formattedPuzzles,
        participants: mergedParticipants,
      },
    });
  } catch (error) {
    console.error("[RaceController] getRaceById error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Student: Join race
 */
export const joinRace = async (req, res) => {
  try {
    const { id } = req.params;
    const { vehicle } = req.body;
    const userId = req.user._id;

    const race = await RaceModel.findById(id);
    if (!race) {
      return res.status(404).json({ success: false, error: "Race not found" });
    }

    const defaultVehicle = vehicle || {
      id: "supercar",
      name: "Supercar",
      color: "#ef4444",
    };

    const existingIndex = race.participants.findIndex(
      (p) => String(p.user) === String(userId)
    );

    let participantObj;

    if (existingIndex >= 0) {
      if (vehicle) {
        race.participants[existingIndex].vehicle = defaultVehicle;
        await race.save();
      }
      participantObj = race.participants[existingIndex];
    } else {
      participantObj = {
        user: userId,
        username: req.user.username || req.user.name || "Racer",
        name: req.user.name || "",
        avatar: req.user.avatar || null,
        vehicle: defaultVehicle,
        meters: 0,
        speed: 0,
        currentPuzzleIndex: 0,
      };
      race.participants.push(participantObj);
      await race.save();
    }

    // Refresh memory cache
    const raceState = await getOrLoadRace(id);
    if (raceState && raceState.participants) {
      const uIdStr = String(userId);
      if (!raceState.participants.has(uIdStr)) {
        raceState.participants.set(uIdStr, {
          userId: uIdStr,
          username: participantObj.username,
          name: participantObj.name,
          avatar: participantObj.avatar,
          vehicle: defaultVehicle,
          meters: 0,
          speed: 0,
          combo: 0,
          maxCombo: 0,
          puzzlesSolved: 0,
          mistakes: 0,
          skipsUsed: 0,
          currentPuzzleIndex: 0,
        });
      }
    }

    // Broadcast in real-time to both the room AND the public lobby
    const io = getRaceIO();
    if (io) {
      io.to(`race_${id}`).emit("participantJoinedRace", {
        participant: {
          userId: String(userId),
          username: participantObj.username,
          name: participantObj.name,
          avatar: participantObj.avatar,
          vehicle: defaultVehicle,
          meters: participantObj.meters || 0,
          speed: participantObj.speed || 0,
        },
        totalParticipants: race.participants.length,
      });

      io.emit("raceLobbyUpdate", {
        raceId: String(id),
        participantCount: race.participants.length,
        status: race.status,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Joined race successfully",
      raceId: id,
    });
  } catch (error) {
    console.error("[RaceController] joinRace error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Student: Update vehicle selection
 */
export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { vehicle } = req.body;
    const userId = req.user._id;

    if (!vehicle || !vehicle.id) {
      return res.status(400).json({ success: false, error: "Vehicle details required" });
    }

    const race = await RaceModel.findById(id);
    if (!race) {
      return res.status(404).json({ success: false, error: "Race not found" });
    }

    const participant = race.participants.find(
      (p) => String(p.user) === String(userId)
    );
    if (participant) {
      participant.vehicle = vehicle;
      await race.save();
    }

    return res.status(200).json({ success: true, vehicle });
  } catch (error) {
    console.error("[RaceController] updateVehicle error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Student: Get final race standings and podium
 */
export const getRaceResults = async (req, res) => {
  try {
    const { id } = req.params;
    const race = await RaceModel.findById(id).lean();
    if (!race) {
      return res.status(404).json({ success: false, error: "Race not found" });
    }

    const standings = (race.participants || []).sort((a, b) => {
      if (b.meters !== a.meters) return b.meters - a.meters;
      if (b.puzzlesSolved !== a.puzzlesSolved) return b.puzzlesSolved - a.puzzlesSolved;
      return a.mistakes - b.mistakes;
    });

    return res.status(200).json({
      success: true,
      raceName: race.name,
      status: race.status,
      standings,
      podium: standings.slice(0, 3),
    });
  } catch (error) {
    console.error("[RaceController] getRaceResults error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
