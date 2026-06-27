import mongoose from "mongoose";

const CompetitionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,

  // Competition timing
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  duration: { type: Number }, // Duration in minutes

  // Puzzles for this competition
  puzzles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Puzzle"
  }],

  // Chapters — organizes puzzles into named groups
  chapters: [{
    name: { type: String, required: true },
    puzzleIds: [{ type: String }] // Store as strings (puzzle _id hex strings)
  }],

  // Competition settings
  maxParticipants: { type: Number },
  isActive: { type: Boolean, default: false },
  isRated: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING"
  },

  // Participants
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    score: {
      type: Number,
      default: 0
    },
    ENDEDPuzzles: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Puzzle"
    }],
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Access Control
  accessCode: { type: String }, // Optional password/code to join



  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for faster queries
CompetitionSchema.index({ status: 1, startTime: 1 });
CompetitionSchema.index({ status: 1, endTime: 1 });   // for LIVE $or check on endTime
CompetitionSchema.index({ startTime: 1, endTime: 1 }); // for time-window queries
CompetitionSchema.index({ isActive: 1 });
CompetitionSchema.index({ "participants.user": 1 });

const CompetitionModel = mongoose.model("Competition", CompetitionSchema);

export default CompetitionModel;
