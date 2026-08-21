import mongoose from "mongoose";

const LearningChapterSchema = new mongoose.Schema(
  {
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningSection",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    learningObjectives: [{ type: String }],
    icon: { type: String, default: "FaChess" },
    order: { type: Number, required: true, default: 0 },
    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    estimatedMinutes: { type: Number, default: 0 },
    exerciseCount: { type: Number, default: 0 },
    prerequisiteChapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LearningChapter",
      default: null,
    },
    requiredCompletionPercent: { type: Number, default: 100, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

LearningChapterSchema.index({ sectionId: 1, slug: 1 }, { unique: true });
LearningChapterSchema.index({ sectionId: 1, order: 1 });
LearningChapterSchema.index({ status: 1, isActive: 1 });

const LearningChapter = mongoose.model("LearningChapter", LearningChapterSchema);
export default LearningChapter;
