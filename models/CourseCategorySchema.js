import mongoose from "mongoose";

const CourseCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true }, // URL-friendly
  description: { type: String, default: "" },
  icon: { type: String, default: "" },        // Icon name or uploaded image path
  color: { type: String, default: "#b58863" }, // Hex color for UI theming
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

CourseCategorySchema.index({ slug: 1 }, { unique: true });
CourseCategorySchema.index({ sortOrder: 1 });
CourseCategorySchema.index({ isActive: 1 });

const CourseCategoryModel = mongoose.model("CourseCategory", CourseCategorySchema);

export default CourseCategoryModel;
