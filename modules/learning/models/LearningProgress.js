import mongoose from "mongoose";

const LearningProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningChapter",
      required: true,
      index: true,
    },
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningExercise",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "MASTERED"],
      default: "NOT_STARTED",
    },
    attempts: { type: Number, default: 0 },
    mistakes: { type: Number, default: 0 },
    hintsUsed: { type: Number, default: 0 },
    bestScore: { type: Number, default: null },
    moveCount: { type: Number, default: null },
    completedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LearningProgressSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });
LearningProgressSchema.index({ userId: 1, chapterId: 1 });

const LearningProgress = mongoose.model("LearningProgress", LearningProgressSchema);
export default LearningProgress;
