import mongoose from "mongoose";

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
  finalRank: {
    type: Number,
    required: true
  },
  finalScore: {
    type: Number,
    required: true
  },
  puzzlesSolved: {
    type: Number,
    required: true
  },
  totalTime: {
    type: Number,
    required: true
  }, // in seconds
  ENDEDAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for unique ranking per event
EventRankingSchema.index({ eventId: 1, userId: 1 }, { unique: true });

// Index for ranking queries
EventRankingSchema.index({ eventId: 1, finalRank: 1 });

const EventRankingModel = mongoose.model("EventRanking", EventRankingSchema);

export default EventRankingModel;
