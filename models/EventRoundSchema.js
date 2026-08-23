import mongoose from "mongoose";

/**
 * EventRound — A round inside an Event.
 * 
 * Rounds can be nested: a parent round (e.g. "Quarter Finals") can have
 * child sub-rounds each linked to their own Competition.
 * 
 * Depth is capped at 2 levels (parent → children).
 * 
 * Each round links to an existing Competition. The competition's
 * startTime / endTime drive when the JOIN button appears.
 * 
 * breakAfterMinutes: how many minutes of break before the NEXT round starts.
 */
const EventRoundSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true
  },

  // null = top-level round; ObjectId = this is a sub-round
  parentRoundId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EventRound",
    default: null
  },

  name: { type: String, required: true },        // "Quarter Final", "Round 1", etc.
  order: { type: Number, required: true },       // position within siblings (0-indexed)

  roundType: {
    type: String,
    enum: ["Puzzle Arena", "Exam"],
    default: "Puzzle Arena"
  },

  // The competition that players will play in this round
  // null for parent rounds that are just containers for sub-rounds
  competitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Competition",
    default: null
  },

  // The exam that players will take in this round (if roundType === "Exam")
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    default: null
  },

  // Break after this round ends (before next round starts), in minutes
  breakAfterMinutes: { type: Number, default: 5 },

  // Denormalized from the linked competition/exam for quick access
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },

  // Status mirrors the linked competition/exam status
  status: {
    type: String,
    enum: ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING"
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// All rounds for an event, ordered
EventRoundSchema.index({ eventId: 1, order: 1 });
EventRoundSchema.index({ examId: 1 });
// All sub-rounds under a parent
EventRoundSchema.index({ parentRoundId: 1, order: 1 });
// Lookup by linked competition
EventRoundSchema.index({ competitionId: 1 });

const EventRoundModel = mongoose.model("EventRound", EventRoundSchema);

export default EventRoundModel;
