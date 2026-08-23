import mongoose from "mongoose";

const ChapterSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  sortOrder: { type: Number, default: 0 },
  isLocked: { type: Boolean, default: false },  // Requires previous chapter completion

  // Ordered lesson references
  lessons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Lesson" }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ChapterSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

ChapterSchema.index({ course: 1, sortOrder: 1 });

const ChapterModel = mongoose.model("Chapter", ChapterSchema);

export default ChapterModel;
