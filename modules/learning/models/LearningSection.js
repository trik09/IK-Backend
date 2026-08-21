import mongoose from "mongoose";

const LearningSectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "FaChess" },
    order: { type: Number, required: true, default: 0 },
    difficulty: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    isActive: { type: Boolean, default: true },
    estimatedMinutes: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

LearningSectionSchema.index({ status: 1, order: 1 });
LearningSectionSchema.index({ isActive: 1 });

const LearningSection = mongoose.model("LearningSection", LearningSectionSchema);
export default LearningSection;
