import mongoose from "mongoose";

const ParticipantSchema = new mongoose.Schema({
  competitionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Competition', 
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
  }, // When user submitted early (optional)
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
ParticipantSchema.index(
  { competitionId: 1, userId: 1 },
  { unique: true }
);

// Leaderboard sorting
ParticipantSchema.index({
  competitionId: 1,
  puzzlesSolved: -1,
  timeSpent: 1,
  score: -1
});

// Fast participant count
ParticipantSchema.index({ competitionId: 1 });

// Active-participation lookup (user rejoining / popup)
ParticipantSchema.index({ userId: 1, isSubmitted: 1 });

const ParticipantModel = mongoose.model("Participant", ParticipantSchema);

export default ParticipantModel;