import mongoose from "mongoose";

/**
 * EventRanking — Final aggregated ranking for a user in an event.
 * 
 * This is computed at event completion by summing scores from
 * CompetitionRanking entries across all rounds of the event.
 * 
 * roundScores stores the per-round breakdown for detailed display
 * on the Event Leaderboard page.
 */
const RoundScoreSchema = new mongoose.Schema({
  roundId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EventRound",
    required: true
  },
  roundName: { type: String, default: "" },
  competitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Competition",
    required: true
  },
  score: { type: Number, default: 0 },
  puzzlesSolved: { type: Number, default: 0 },
  timeSpent: { type: Number, default: 0 },        // seconds
  rank: { type: Number, default: null },           // rank in that round
  participated: { type: Boolean, default: true },
}, { _id: false });

const EventRankingSchema = new mongoose.Schema({
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
  fullName: { type: String, default: "" },
  age: { type: Number, default: null },            // used for age-category filtering

  // Per-round scores
  roundScores: [RoundScoreSchema],

  // Aggregated totals
  finalRank: { type: Number, required: true },
  finalScore: { type: Number, required: true },
  totalPuzzlesSolved: { type: Number, default: 0 },
  totalTimeSpent: { type: Number, default: 0 },   // seconds

  computedAt: {
    type: Date,
    default: Date.now
  }
});

// Unique ranking per user per event
EventRankingSchema.index({ eventId: 1, userId: 1 }, { unique: true });

// Leaderboard order
EventRankingSchema.index({ eventId: 1, finalRank: 1 });

// Age-category filtering
EventRankingSchema.index({ eventId: 1, age: 1 });

const EventRankingModel = mongoose.model("EventRanking", EventRankingSchema);

export default EventRankingModel;
