import mongoose from "mongoose";

const PuzzleAttemptSchema = new mongoose.Schema({
  competitionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Competition', 
    required: true 
  },
  puzzleId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Puzzle', 
    required: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  status: {
    type: String,
    enum: ['in_progress', 'solved', 'failed'],
    default: 'in_progress'
  },
  solution: { 
    type: mongoose.Schema.Types.Mixed 
  },
  boardPosition: { 
    type: String // FEN string
  },
  moveHistory: [{ 
    type: String 
  }],
  timeSpent: { 
    type: Number, 
    default: 0 
  }, // in seconds
  scoreEarned: { 
    type: Number, 
    default: 0 
  },
  isLocked: { 
    type: Boolean, 
    default: false 
  },
  attemptedAt: { 
    type: Date, 
    default: Date.now 
  },
  completedAt: { 
    type: Date 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Compound index for unique attempt per puzzle per user per competition
PuzzleAttemptSchema.index({ 
  competitionId: 1, 
  puzzleId: 1, 
  userId: 1 
}, { unique: true });

// Index for competition queries
PuzzleAttemptSchema.index({ competitionId: 1, status: 1 });
PuzzleAttemptSchema.index({ userId: 1, status: 1 });
PuzzleAttemptSchema.index({
  competitionId: 1,
  userId: 1,
  status: 1,
  timeSpent: 1,
});

// Update the updatedAt field on save
PuzzleAttemptSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const PuzzleAttemptModel = mongoose.model("PuzzleAttempt", PuzzleAttemptSchema);

export default PuzzleAttemptModel;