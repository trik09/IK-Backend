import EventModel from "../models/EventSchema.js";
import EventRoundModel from "../models/EventRoundSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import EventRankingModel from "../models/EventRankingSchema.js";
import CompetitionModel from "../models/CompetitionSchema.js";
import CompetitionRankingModel from "../models/CompetitionRankingSchema.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const computeStatus = (startTime, endTime) => {
  const now = new Date();
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (now >= start && now < end) return "LIVE";
  if (now >= end) return "ENDED";
  return "UPCOMING";
};

// ─── EVENT CRUD ─────────────────────────────────────────────────────────────

/** Create a new event */
export const createEvent = async (req, res) => {
  try {
    const {
      name, description, startTime, duration,
      maxParticipants, accessCode, entryFeeType, entryFeeAmount,
      qrCodeUrl, pricing
    } = req.body;

    if (!name || !startTime || !duration) {
      return res.status(400).json({ message: "Name, start time, and duration are required" });
    }

    const start = new Date(startTime);
    const durationMins = parseInt(duration);
    const end = new Date(start.getTime() + durationMins * 60 * 1000);
    const status = computeStatus(start, end);

    const event = await EventModel.create({
      name,
      description,
      startTime: start,
      endTime: end,
      duration: durationMins,
      maxParticipants,
      status,
      isActive: status === "LIVE",
      accessCode,
      entryFeeType: entryFeeType || "free",
      entryFeeAmount: entryFeeType === "paid" ? parseFloat(entryFeeAmount) || 0 : 0,
      qrCodeUrl: entryFeeType === "paid" ? qrCodeUrl || "" : "",
      pricing: pricing || [],
      createdBy: req.admin._id,
    });

    res.status(201).json({ message: "Event created successfully", event });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ message: "Failed to create event", error: error.message });
  }
};

/** Get all events (paginated, filterable) */
export const getEvents = async (req, res) => {
  try {
    const { status, isActive, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const now = new Date();
    const query = {};

    if (status) {
      const s = status.toUpperCase();
      if (s === "LIVE") {
        query.endTime = { $gt: now };
        query.$or = [
          { status: "LIVE" },
          { status: "UPCOMING", startTime: { $lte: now } },
        ];
      } else if (s === "UPCOMING") {
        query.status = "UPCOMING";
        query.startTime = { $gt: now };
      } else if (s === "ENDED") {
        query.$or = [{ status: "ENDED" }, { endTime: { $lte: now } }];
      } else {
        query.status = s;
      }
    }

    if (isActive !== undefined) query.isActive = isActive === "true";

    const skip = (pageNum - 1) * limitNum;
    const sortOrder = status?.toUpperCase() === "ENDED" ? { startTime: -1 } : { startTime: 1 };

    const [events, total] = await Promise.all([
      EventModel.find(query)
        .select("name description status startTime endTime duration maxParticipants entryFeeType entryFeeAmount pricing createdAt")
        .sort(sortOrder)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      EventModel.countDocuments(query),
    ]);

    // Promote stale UPCOMING → LIVE in background
    const staleUpcoming = events.filter(
      (e) => e.status === "UPCOMING" && new Date(e.startTime) <= now && new Date(e.endTime) > now
    );
    if (staleUpcoming.length) {
      EventModel.updateMany(
        { _id: { $in: staleUpcoming.map((e) => e._id) } },
        { status: "LIVE", isActive: true }
      ).catch(() => {});
    }

    // Participant counts
    const eventIds = events.map((e) => e._id);
    const participantCounts = eventIds.length
      ? await EventParticipantModel.aggregate([
          { $match: { eventId: { $in: eventIds } } },
          {
            $group: {
              _id: "$eventId",
              registered: { $sum: 1 },
              approved: { $sum: { $cond: ["$isApproved", 1, 0] } },
            },
          },
        ])
      : [];
    const countMap = new Map(participantCounts.map((p) => [p._id.toString(), p]));

    // ── Check which ended events the current user actually participated in ──
    const endedEventIds = events
      .filter(e => {
        const end = new Date(e.endTime);
        return e.status === "ENDED" || end <= now;
      })
      .map(e => e._id);

    const userPlayedEventSet = new Set();
    if (req.user && endedEventIds.length) {
      const userRegs = await EventParticipantModel.find({
        eventId: { $in: endedEventIds },
        userId: req.user._id,
        isApproved: true,
      }).select("eventId").lean();
      userRegs.forEach(r => userPlayedEventSet.add(r.eventId.toString()));
    }

    const enriched = events.map((e) => {
      let effectiveStatus = e.status;
      if (e.status === "UPCOMING" && new Date(e.startTime) <= now && new Date(e.endTime) > now) {
        effectiveStatus = "LIVE";
      }
      const isEnded = effectiveStatus === "ENDED" || new Date(e.endTime) <= now;
      const counts = countMap.get(e._id.toString()) || { registered: 0, approved: 0 };
      // hasUserParticipated is only set for ended events; null for live/upcoming
      const hasUserParticipated = isEnded
        ? userPlayedEventSet.has(e._id.toString())
        : null;
      return {
        _id: e._id,
        name: e.name,
        description: e.description,
        status: effectiveStatus,
        startTime: e.startTime,
        endTime: e.endTime,
        duration: e.duration,
        maxParticipants: e.maxParticipants,
        entryFeeType: e.entryFeeType || "free",
        entryFeeAmount: e.entryFeeAmount || 0,
        pricing: e.pricing || [],
        createdAt: e.createdAt,
        participantCount: counts.approved,
        approvedCount: counts.approved,
        registeredCount: counts.registered,
        hasUserParticipated,
      };
    });

    res.status(200).json({
      success: true,
      data: enriched,
      pagination: {
        current: pageNum,
        total: Math.ceil(total / limitNum),
        count: events.length,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ success: false, message: "Failed to fetch events" });
  }
};

/** Get event by ID — includes rounds tree */
export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await EventModel.findById(id).populate("createdBy", "name email").lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Load rounds
    const rounds = await getRoundsTree(id);

    res.status(200).json({ success: true, data: { ...event, rounds } });
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ success: false, message: "Failed to fetch event" });
  }
};

/** Update event */
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const event = await EventModel.findById(id).select("_id startTime endTime duration").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (updates.startTime || updates.duration) {
      const start = new Date(updates.startTime || event.startTime);
      const durationMins = updates.duration ? parseInt(updates.duration) : event.duration;
      updates.duration = durationMins;
      updates.endTime = new Date(start.getTime() + durationMins * 60 * 1000);
    }

    if (updates.startTime || updates.endTime) {
      const start = new Date(updates.startTime || event.startTime);
      const end = new Date(updates.endTime || event.endTime);
      const status = computeStatus(start, end);
      updates.status = status;
      updates.isActive = status === "LIVE";
    }

    const allowedFields = [
      "name", "description", "startTime", "endTime", "duration",
      "maxParticipants", "status", "isActive", "accessCode",
      "entryFeeType", "entryFeeAmount", "qrCodeUrl", "pricing"
    ];
    const $set = { updatedAt: new Date() };
    allowedFields.forEach((f) => {
      if (updates[f] !== undefined) $set[f] = updates[f];
    });

    const updated = await EventModel.findByIdAndUpdate(id, { $set }, { new: true });
    res.status(200).json({ message: "Event updated successfully", event: updated });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ message: "Failed to update event", error: error.message });
  }
};

/** Delete event (cascades to rounds and participants) */
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await EventModel.findByIdAndDelete(id);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Cascade delete
    await Promise.all([
      EventRoundModel.deleteMany({ eventId: id }),
      EventParticipantModel.deleteMany({ eventId: id }),
      EventRankingModel.deleteMany({ eventId: id }),
    ]);

    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ message: "Failed to delete event" });
  }
};

// ─── ROUND MANAGEMENT ───────────────────────────────────────────────────────

/**
 * Internal helper: build the nested round tree for an event.
 * Returns top-level rounds with their children embedded.
 */
async function getRoundsTree(eventId) {
  const allRounds = await EventRoundModel.find({ eventId })
    .populate("competitionId", "name startTime endTime status duration puzzles")
    .sort({ order: 1 })
    .lean();

  // Sync status from linked competition
  allRounds.forEach((r) => {
    if (r.competitionId) {
      r.startTime = r.competitionId.startTime;
      r.endTime = r.competitionId.endTime;
      r.status = computeStatus(r.competitionId.startTime, r.competitionId.endTime);
    }
  });

  // Build tree
  const topLevel = allRounds.filter((r) => !r.parentRoundId);
  const children = allRounds.filter((r) => r.parentRoundId);

  return topLevel.map((parent) => ({
    ...parent,
    subRounds: children
      .filter((c) => c.parentRoundId?.toString() === parent._id.toString())
      .sort((a, b) => a.order - b.order),
  }));
}

/** GET /event/:id/rounds */
export const getRoundsForEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const rounds = await getRoundsTree(id);
    res.status(200).json({ success: true, data: rounds });
  } catch (error) {
    console.error("Error fetching rounds:", error);
    res.status(500).json({ success: false, message: "Failed to fetch rounds" });
  }
};

/** POST /event/:id/rounds */
export const createRound = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { name, competitionId, parentRoundId, breakAfterMinutes, order } = req.body;

    if (!name) return res.status(400).json({ message: "Round name is required" });

    // Validate event exists
    const event = await EventModel.findById(eventId).select("_id").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Validate competition if provided
    let compData = null;
    if (competitionId) {
      compData = await CompetitionModel.findById(competitionId)
        .select("startTime endTime status")
        .lean();
      if (!compData) return res.status(400).json({ message: "Competition not found" });
    }

    // Auto-order if not provided
    const siblings = await EventRoundModel.countDocuments({
      eventId,
      parentRoundId: parentRoundId || null,
    });

    const round = await EventRoundModel.create({
      eventId,
      parentRoundId: parentRoundId || null,
      name,
      order: order !== undefined ? order : siblings,
      competitionId: competitionId || null,
      breakAfterMinutes: breakAfterMinutes ?? 5,
      startTime: compData?.startTime || null,
      endTime: compData?.endTime || null,
      status: compData ? computeStatus(compData.startTime, compData.endTime) : "UPCOMING",
    });

    const populated = await EventRoundModel.findById(round._id)
      .populate("competitionId", "name startTime endTime status duration")
      .lean();

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error creating round:", error);
    res.status(500).json({ message: "Failed to create round", error: error.message });
  }
};

/** PUT /event/:id/rounds/:roundId */
export const updateRound = async (req, res) => {
  try {
    const { roundId } = req.params;
    const { name, competitionId, breakAfterMinutes, order } = req.body;

    const round = await EventRoundModel.findById(roundId);
    if (!round) return res.status(404).json({ message: "Round not found" });

    if (name !== undefined) round.name = name;
    if (breakAfterMinutes !== undefined) round.breakAfterMinutes = breakAfterMinutes;
    if (order !== undefined) round.order = order;

    // Update competition link
    if (competitionId !== undefined) {
      if (competitionId) {
        const comp = await CompetitionModel.findById(competitionId)
          .select("startTime endTime status")
          .lean();
        if (!comp) return res.status(400).json({ message: "Competition not found" });
        round.competitionId = competitionId;
        round.startTime = comp.startTime;
        round.endTime = comp.endTime;
        round.status = computeStatus(comp.startTime, comp.endTime);
      } else {
        round.competitionId = null;
        round.startTime = null;
        round.endTime = null;
        round.status = "UPCOMING";
      }
    }

    round.updatedAt = new Date();
    await round.save();

    const populated = await EventRoundModel.findById(roundId)
      .populate("competitionId", "name startTime endTime status duration")
      .lean();

    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error updating round:", error);
    res.status(500).json({ message: "Failed to update round", error: error.message });
  }
};

/** DELETE /event/:id/rounds/:roundId */
export const deleteRound = async (req, res) => {
  try {
    const { roundId } = req.params;
    const round = await EventRoundModel.findByIdAndDelete(roundId);
    if (!round) return res.status(404).json({ message: "Round not found" });

    // Delete sub-rounds too
    await EventRoundModel.deleteMany({ parentRoundId: roundId });

    res.status(200).json({ success: true, message: "Round deleted successfully" });
  } catch (error) {
    console.error("Error deleting round:", error);
    res.status(500).json({ message: "Failed to delete round" });
  }
};

// ─── PARTICIPANT MANAGEMENT ──────────────────────────────────────────────────

/** POST /event/:id/register — User registers for event */
export const registerForEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, whatsappNumber, age, gender, fideRating, utrNumber } = req.body;
    const userId = req.user._id;
    const username = req.user.username || req.user.name;

    if (!fullName || !whatsappNumber || !age || !gender) {
      return res.status(400).json({ message: "Missing required registration details" });
    }

    const event = await EventModel.findById(id).select("entryFeeType").lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (event.entryFeeType === "paid" && (!utrNumber || !utrNumber.trim())) {
      return res.status(400).json({ message: "UTR / Transaction number is required for paid events." });
    }

    const existing = await EventParticipantModel.findOne({ eventId: id, userId });
    if (existing) {
      return res.status(400).json({ message: "Already registered for this event", participant: existing });
    }

    const participant = await EventParticipantModel.create({
      eventId: id,
      userId,
      username,
      fullName,
      whatsappNumber,
      age: parseInt(age),
      gender,
      fideRating: fideRating || "",
      utrNumber: event.entryFeeType === "paid" ? utrNumber.trim() : "",
      isApproved: false,
    });

    res.status(201).json({
      message: "Registration submitted successfully. Waiting for admin approval.",
      participant,
    });
  } catch (error) {
    console.error("Error registering for event:", error);
    res.status(500).json({ message: "Failed to register for event" });
  }
};

/** GET /event/:id/participants — Admin: all participants */
export const getEventParticipants = async (req, res) => {
  try {
    const { id } = req.params;
    const participants = await EventParticipantModel.find({ eventId: id })
      .populate("userId", "name email username")
      .sort({ registeredAt: -1 });

    res.status(200).json({ success: true, data: participants });
  } catch (error) {
    console.error("Error fetching participants:", error);
    res.status(500).json({ message: "Failed to fetch participants" });
  }
};

/** PUT /event/:id/approve/:participantId — Admin: approve/unapprove */
export const approveParticipant = async (req, res) => {
  try {
    const { id, participantId } = req.params;
    const isApproved = req.body?.isApproved !== undefined ? req.body.isApproved : true;

    const participant = await EventParticipantModel.findOne({ _id: participantId, eventId: id });
    if (!participant) return res.status(404).json({ message: "Participant not found for this event" });

    participant.isApproved = isApproved;
    await participant.save();

    res.status(200).json({
      message: `Participant ${isApproved ? "approved" : "unapproved"} successfully`,
      participant,
    });
  } catch (error) {
    console.error("Error updating participant status:", error);
    res.status(500).json({ message: "Failed to update participant status" });
  }
};

/** GET /event/user/registrations — User: get their own registrations */
export const getUserRegistrations = async (req, res) => {
  try {
    const userId = req.user._id;
    const registrations = await EventParticipantModel.find({ userId })
      .populate("eventId", "name startTime endTime status entryFeeType")
      .lean();

    res.status(200).json({ success: true, data: registrations });
  } catch (error) {
    console.error("Error fetching user registrations:", error);
    res.status(500).json({ message: "Failed to fetch registrations" });
  }
};

// ─── EVENT LEADERBOARD ───────────────────────────────────────────────────────

/**
 * GET /event/:id/leaderboard
 * 
 * Aggregates CompetitionRanking scores across all rounds of the event.
 * Also checks if a pre-computed EventRanking exists and returns that if
 * the event has already ended, otherwise computes on-the-fly.
 */
export const getEventLeaderboard = async (req, res) => {
  try {
    const { id: eventId } = req.params;

    const event = await EventModel.findById(eventId)
      .select("name status pricing startTime endTime")
      .lean();
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Load all rounds (flat, not tree)
    const rounds = await EventRoundModel.find({ eventId })
      .select("_id name competitionId order parentRoundId")
      .lean();

    const competitionIds = rounds
      .filter((r) => r.competitionId)
      .map((r) => r.competitionId);

    if (competitionIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { event, rounds: [], leaderboard: [], pricing: event.pricing || [] },
      });
    }

    // Load CompetitionRanking records for all rounds
    const rankings = await CompetitionRankingModel.find({
      competitionId: { $in: competitionIds },
    })
      .populate("userId", "name username avatar")
      .lean();

    // Group by userId
    const userMap = new Map();
    const roundMap = new Map(rounds.map((r) => [r.competitionId?.toString(), r]));

    for (const ranking of rankings) {
      const uid = ranking.userId?._id?.toString() || ranking.userId?.toString();
      if (!uid) continue;

      const round = roundMap.get(ranking.competitionId?.toString());

      if (!userMap.has(uid)) {
        userMap.set(uid, {
          userId: ranking.userId,
          username: ranking.username,
          totalScore: 0,
          totalPuzzlesSolved: 0,
          totalTimeSpent: 0,
          roundScores: [],
        });
      }

      const entry = userMap.get(uid);
      entry.totalScore += ranking.finalScore || 0;
      entry.totalPuzzlesSolved += ranking.puzzlesSolved || 0;
      entry.totalTimeSpent += ranking.totalTime || 0;
      entry.roundScores.push({
        roundId: round?._id || null,
        roundName: round?.name || "Round",
        competitionId: ranking.competitionId,
        score: ranking.finalScore,
        puzzlesSolved: ranking.puzzlesSolved,
        timeSpent: ranking.totalTime,
        rank: ranking.finalRank,
      });
    }

    // Also pull EventParticipant data for age-based filtering
    const participants = await EventParticipantModel.find({ eventId, isApproved: true })
      .select("userId age fullName")
      .lean();
    const ageMap = new Map(participants.map((p) => [p.userId?.toString(), p.age]));
    const nameMap = new Map(participants.map((p) => [p.userId?.toString(), p.fullName]));

    // Build sorted leaderboard
    const leaderboard = Array.from(userMap.values())
      .map((entry) => {
        const uid = entry.userId?._id?.toString() || entry.userId?.toString();
        return {
          ...entry,
          age: ageMap.get(uid) || null,
          fullName: nameMap.get(uid) || entry.username,
        };
      })
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if (a.totalTimeSpent !== b.totalTimeSpent) return a.totalTimeSpent - b.totalTimeSpent;
        return b.totalPuzzlesSolved - a.totalPuzzlesSolved;
      })
      .map((entry, idx) => ({ ...entry, finalRank: idx + 1 }));

    res.status(200).json({
      success: true,
      data: {
        event,
        rounds,
        leaderboard,
        pricing: event.pricing || [],
      },
    });
  } catch (error) {
    console.error("Error fetching event leaderboard:", error);
    res.status(500).json({ message: "Failed to fetch event leaderboard" });
  }
};

export default {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  createRound,
  getRoundsForEvent,
  updateRound,
  deleteRound,
  registerForEvent,
  getEventParticipants,
  approveParticipant,
  getUserRegistrations,
  getEventLeaderboard,
};
