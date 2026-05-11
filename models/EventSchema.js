import mongoose from "mongoose";

const EventSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,

  // Event timing
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  duration: { type: Number }, // Duration in minutes

  // Puzzles for this event
  puzzles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Puzzle"
  }],

  // Chapters — organizes puzzles into named groups
  chapters: [{
    name: { type: String, required: true },
    puzzleIds: [{ type: String }] // Store as strings (puzzle _id hex strings)
  }],

  // Event settings
  maxParticipants: { type: Number },
  isActive: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING"
  },

  // Participants (legacy support / simple list)
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
  accessCode: { type: String }, 

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for faster queries
EventSchema.index({ status: 1, startTime: 1 });
EventSchema.index({ isActive: 1 });
EventSchema.index({ "participants.user": 1 });

const EventModel = mongoose.model("Event", EventSchema);

export default EventModel;
