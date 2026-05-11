import mongoose from "mongoose";

const EventParticipantSchema = new mongoose.Schema({
  eventId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Event', 
    required: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  username: { 
    type: String, 
    required: true 
  },

  // Event Registration details
  fullName: { type: String, required: true },
  whatsappNumber: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, required: true },
  fideRating: { type: String, default: "" },

  isApproved: { type: Boolean, default: false },

  score: { 
    type: Number, 
    default: 0 
  },
  puzzlesSolved: { 
    type: Number, 
    default: 0 
  },
  isSubmitted: { 
    type: Boolean, 
    default: false 
  },
  timeSpent: { 
    type: Number, 
    default: 0 
  }, // in seconds
  joinedAt: { 
    type: Date, 
    default: Date.now 
  },
  submittedAt: { 
    type: Date 
  }, 
  lastActivity: { 
    type: Date, 
    default: Date.now 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  status: {
    type: String,
    enum: ["JOINED", "PLAYING", "SUBMITTED"],
    default: "JOINED"
  }
});

// Unique participation
EventParticipantSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true }
);

// Leaderboard sorting
EventParticipantSchema.index({
  eventId: 1,
  puzzlesSolved: -1,
  timeSpent: 1,
  score: -1
});

// Fast participant count
EventParticipantSchema.index({ eventId: 1 });

const EventParticipantModel = mongoose.model("EventParticipant", EventParticipantSchema);

export default EventParticipantModel;
