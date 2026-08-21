import mongoose from "mongoose";

const LearningAttemptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningExercise",
      required: true,
      index: true,
    },
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningChapter",
      required: true,
    },
    moveSequence: [{ type: String }],
    correct: { type: Boolean, default: false },
    hintsUsed: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LearningAttemptSchema.index({ userId: 1, exerciseId: 1, createdAt: -1 });
LearningAttemptSchema.index({ exerciseId: 1, createdAt: -1 });

const LearningAttempt = mongoose.model("LearningAttempt", LearningAttemptSchema);
export default LearningAttempt;
