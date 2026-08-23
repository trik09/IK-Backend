import mongoose from "mongoose";

const LessonProgressSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  lesson: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
  chapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", required: true },
  status: {
    type: String,
    enum: ["not_started", "in_progress", "completed"],
    default: "not_started",
  },
  blocksCompleted: [{ type: mongoose.Schema.Types.ObjectId }], // Block _ids the user has interacted with
  quizScore: { type: Number, default: 0 },  // If lesson has quiz blocks
  timeSpent: { type: Number, default: 0 },  // Seconds
  completedAt: { type: Date, default: null },
  xpEarned: { type: Number, default: 0 },
  lastBlockId: { type: mongoose.Schema.Types.ObjectId, default: null }, // Last viewed block
});

// A user tracks one progress record per lesson
LessonProgressSchema.index({ user: 1, lesson: 1 }, { unique: true });
LessonProgressSchema.index({ user: 1, course: 1 });
LessonProgressSchema.index({ user: 1, chapter: 1 });

const LessonProgressModel = mongoose.model("LessonProgress", LessonProgressSchema);

export default LessonProgressModel;
