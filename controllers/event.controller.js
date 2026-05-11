import EventModel from "../models/EventSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import EventParticipantModel from "../models/EventParticipantSchema.js";

// Create a new event
export const createEvent = async (req, res) => {
  try {
    const { name, description, startTime, duration, puzzles, maxParticipants, accessCode, chapters } =
      req.body;

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

    // Validate puzzles exist
    if (puzzles && puzzles.length > 0) {
      const existingPuzzles = await PuzzleModel.find({ _id: { $in: puzzles } });
      if (existingPuzzles.length !== puzzles.length) {
        return res.status(400).json({
          message: "Some puzzles do not exist",
        });
      }
    }

    // Determine status based on start time
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

    const event = await EventModel.create({
      name,
      description,
      startTime,
      endTime: end,
      duration: durationInMinutes,
      puzzles: puzzles || [],
      chapters: chapters || [],
      maxParticipants,
      status,
      isActive,
      accessCode,
      createdBy: req.admin._id,
    });

    res.status(201).json({
      message: "Event created successfully",
      event,
    });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({
      message: "Failed to create event",
      error: error.message,
    });
  }
};

// Get all events
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
        query.$or = [
          { status: "LIVE" },
          { status: "UPCOMING", startTime: { $lte: now }, endTime: { $gt: now } },
        ];
      } else if (s === "UPCOMING") {
        query.status = "UPCOMING";
        query.startTime = { $gt: now };
      } else {
        query.status = s;
      }
    }

    if (isActive !== undefined) query.isActive = isActive === "true";

    const skip = (pageNum - 1) * limitNum;

    // Sort order:
    //  - Live / Upcoming  → startTime ASC  (soonest event on page 1)
    //  - Ended / no filter → startTime DESC (most recently ended first)
    const resolvedStatus = status ? status.toUpperCase() : null;
    const sortOrder =
      resolvedStatus === "ENDED" ? { startTime: -1 } : { startTime: 1 };

    const [events, total] = await Promise.all([
      EventModel.find(query)
        .select(
          "name description status startTime endTime duration puzzles participants maxParticipants createdAt"
        )
        .populate("puzzles")
        .sort(sortOrder)
        .skip(skip)
        .limit(limitNum)
        .lean(),

      EventModel.countDocuments(query),
    ]);

    // Async: promote any stale UPCOMING→LIVE events
    const staleUpcoming = events.filter(
      (e) => e.status === "UPCOMING" && new Date(e.startTime) <= now && new Date(e.endTime) > now
    );
    if (staleUpcoming.length) {
      EventModel.updateMany(
        { _id: { $in: staleUpcoming.map((e) => e._id) } },
        { status: "LIVE", isActive: true }
      ).catch(() => {});
    }

    // Get accurate participant counts from EventParticipantModel
    const eventIds = events.map((e) => e._id);
    const participants = await EventParticipantModel.find({ eventId: { $in: eventIds } }).lean();
    
    const enriched = events.map((e) => {
      let effectiveStatus = e.status;
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      if (e.status === "UPCOMING" && start <= now && end > now) {
        effectiveStatus = "LIVE";
      }

      const eventParticipants = participants.filter(p => p.eventId.toString() === e._id.toString());
      const registered = eventParticipants.length;
      const approved = eventParticipants.filter(p => p.isApproved).length;

      return {
        ...e,
        status: effectiveStatus,
        participantCount: approved, // Backward compatibility
        approvedCount: approved,
        registeredCount: registered,
        participants: undefined,
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
    res.status(500).json({
      success: false,
      message: "Failed to fetch events",
    });
  }
};

// Get event by ID
export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await EventModel.findById(id)
      .populate("puzzles")
      .populate("createdBy", "name email");

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    res.status(200).json({
      success: true,
      data: event,
    });
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch event",
    });
  }
};

// Update event
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const event = await EventModel.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (updates.puzzles !== undefined) {
      if (Array.isArray(updates.puzzles) && updates.puzzles.length > 0) {
        const existingPuzzles = await PuzzleModel.find({
          _id: { $in: updates.puzzles },
        });
        if (existingPuzzles.length !== updates.puzzles.length) {
          return res.status(400).json({
            message: "Some puzzles do not exist",
          });
        }
      }
    }

    if (updates.startTime || updates.duration) {
      const start = new Date(updates.startTime || event.startTime);
      const durationInMinutes =
        updates.duration !== undefined && updates.duration !== ""
          ? parseInt(updates.duration)
          : event.duration;

      if (isNaN(durationInMinutes)) {
        return res.status(400).json({ message: "Invalid duration value" });
      }

      updates.duration = durationInMinutes;
      updates.endTime = new Date(start.getTime() + durationInMinutes * 60 * 1000);
    }

    if (updates.startTime || updates.endTime || updates.duration) {
      const now = new Date();
      const start = new Date(updates.startTime || event.startTime);
      const end = new Date(updates.endTime || event.endTime);

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

    updates.updatedAt = new Date();

    const allowedFields = ['name', 'description', 'startTime', 'endTime', 'duration', 'puzzles', 'chapters', 'maxParticipants', 'status', 'isActive', 'accessCode', 'updatedAt'];
    const validUpdates = {};
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === 'maxParticipants' && (updates[field] === '' || updates[field] === null)) {
          validUpdates[field] = undefined;
        } else if (field === 'maxParticipants' && typeof updates[field] === 'string') {
          validUpdates[field] = parseInt(updates[field]) || undefined;
        } else {
          validUpdates[field] = updates[field];
        }
      }
    });

    Object.assign(event, validUpdates);

    if (updates.accessCode === "" || updates.accessCode === null) {
      event.accessCode = undefined;
    }

    await event.save();

    res.status(200).json({
      message: "Event updated successfully",
      event,
    });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({
      message: "Failed to update event",
      error: error.message,
    });
  }
};

// Delete event
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await EventModel.findByIdAndDelete(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ message: "Failed to delete event" });
  }
};

// Register for event (User action)
export const registerForEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, whatsappNumber, age, gender, fideRating } = req.body;
    const userId = req.user._id;
    const username = req.user.username || req.user.name;

    if (!fullName || !whatsappNumber || !age || !gender) {
      return res.status(400).json({ message: "Missing required registration details" });
    }

    const event = await EventModel.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    let participant = await EventParticipantModel.findOne({ eventId: id, userId });

    if (participant) {
      return res.status(400).json({ 
        message: "Already registered for this event", 
        participant 
      });
    }

    participant = await EventParticipantModel.create({
      eventId: id,
      userId,
      username,
      fullName,
      whatsappNumber,
      age: parseInt(age),
      gender,
      fideRating: fideRating || "",
      isApproved: false, // Admin needs to approve
      score: 0,
      puzzlesSolved: 0,
      timeSpent: 0,
    });

    res.status(201).json({
      message: "Registration submitted successfully. Waiting for admin approval.",
      participant
    });
  } catch (error) {
    console.error("Error registering for event:", error);
    res.status(500).json({ message: "Failed to register for event" });
  }
};

// Get all registered participants for an event (Admin action)
export const getEventParticipants = async (req, res) => {
  try {
    const { id } = req.params;
    
    const participants = await EventParticipantModel.find({ eventId: id })
      .populate("userId", "name email username")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: participants
    });
  } catch (error) {
    console.error("Error fetching participants:", error);
    res.status(500).json({ message: "Failed to fetch participants" });
  }
};

// Approve participant (Admin action)
export const approveParticipant = async (req, res) => {
  try {
    const { id, participantId } = req.params;
    const isApproved = req.body && req.body.isApproved !== undefined ? req.body.isApproved : true;

    const participant = await EventParticipantModel.findOne({ _id: participantId, eventId: id });
    if (!participant) {
      return res.status(404).json({ message: "Participant not found for this event" });
    }

    participant.isApproved = isApproved;
    await participant.save();

    // Sync with legacy array if approved
    if (isApproved) {
      await EventModel.findByIdAndUpdate(id, {
        $addToSet: {
          participants: {
            user: participant.userId,
            score: 0,
            joinedAt: new Date(),
          }
        }
      });
    } else {
      // If revoked approval, remove from legacy
      await EventModel.findByIdAndUpdate(id, {
        $pull: {
          participants: { user: participant.userId }
        }
      });
    }

    res.status(200).json({
      message: `Participant ${isApproved ? 'approved' : 'unapproved'} successfully`,
      participant
    });
  } catch (error) {
    console.error("Error updating participant status:", error);
    res.status(500).json({ message: "Failed to update participant status" });
  }
};

export const getUserRegistrations = async (req, res) => {
  try {
    const userId = req.user._id;
    const registrations = await EventParticipantModel.find({ userId });
    res.status(200).json({
      success: true,
      data: registrations
    });
  } catch (error) {
    console.error("Error fetching user registrations:", error);
    res.status(500).json({ message: "Failed to fetch registrations" });
  }
};

export default {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  registerForEvent,
  getEventParticipants,
  approveParticipant,
  getUserRegistrations
};

