import mongoose from "mongoose";

const PuzzleHistorySchema = new mongoose.Schema({
  puzzleId: { type: mongoose.Schema.Types.ObjectId, ref: "Puzzle", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  isSolved: { type: Boolean, required: true },
  usedHints: { type: Number, default: 0 },
  attempts: { type: Number, default: 1 },
  timeTaken: { type: Number, default: 0 },

  // ELO Rating Metadata
  isFirstAttempt: { type: Boolean, default: true },
  userRatingBefore: { type: Number },
  userRatingAfter: { type: Number },
  puzzleRating: { type: Number },
  ratingDelta: { type: Number, default: 0 },
  kFactor: { type: Number },

  createdAt: { type: Date, default: Date.now }
});

PuzzleHistorySchema.index({ userId: 1, puzzleId: 1 });
PuzzleHistorySchema.index({ userId: 1, isSolved: 1 });

const PuzzleHistoryModel = mongoose.model("PuzzleHistory", PuzzleHistorySchema);

export default PuzzleHistoryModel;