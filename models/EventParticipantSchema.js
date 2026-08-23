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

  // Registration details
  fullName: { type: String, required: true },
  whatsappNumber: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, required: true },
  fideRating: { type: String, default: "" },
  utrNumber: { type: String, default: "" },

  // Configurable dynamic registration fields
  email: { type: String, default: "" },
  chessRating: { type: String, default: "" },
  fideId: { type: String, default: "" },
  chesscomUsername: { type: String, default: "" },
  lichessUsername: { type: String, default: "" },
  city: { type: String, default: "" },
  state: { type: String, default: "" },
  schoolCollege: { type: String, default: "" },
  paymentScreenshotUrl: { type: String, default: "" },
  declarationAccepted: { type: Boolean, default: false },
  additionalAnswers: [{
    questionText: String,
    answerText: String
  }],

  // Approval status
  isApproved: { type: Boolean, default: false },
  approvalStatus: { 
    type: String, 
    enum: ["PENDING", "APPROVED", "REJECTED"], 
    default: "PENDING" 
  },

  // ── Legacy fields (used by old liveEvent.controller.js — do not remove) ──
  // New event system uses CompetitionRanking for scoring. These fields remain
  // to avoid crashes in the old live-event pipeline until it is phased out.
  score: { type: Number, default: 0 },
  puzzlesSolved: { type: Number, default: 0 },
  timeSpent: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["WAITING", "JOINED", "PLAYING", "SUBMITTED", null],
    default: null
  },
  isActive: { type: Boolean, default: false },
  isSubmitted: { type: Boolean, default: false },
  joinedAt: { type: Date, default: null },
  submittedAt: { type: Date, default: null },
  // ── End Legacy ────────────────────────────────────────────────────────────

  registeredAt: { 
    type: Date, 
    default: Date.now 
  },
  lastActivity: { 
    type: Date, 
    default: Date.now 
  }
});

// Unique participation per event
EventParticipantSchema.index(
  { eventId: 1, userId: 1 },
  { unique: true }
);

// Fast participant count & lookup
EventParticipantSchema.index({ eventId: 1, isApproved: 1 });

const EventParticipantModel = mongoose.model("EventParticipant", EventParticipantSchema);

export default EventParticipantModel;
