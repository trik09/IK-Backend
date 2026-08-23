import mongoose from "mongoose";

const CourseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  subtitle: { type: String, default: "" },
  description: { type: String, default: "" },      // Rich text / markdown
  thumbnail: { type: String, default: "" },         // Image path
  previewVideo: { type: String, default: "" },      // Optional intro video URL

  // ── Categorization ─────────────────────────────────────────────────────
  category: { type: mongoose.Schema.Types.ObjectId, ref: "CourseCategory" },
  tags: [{ type: String }],
  difficulty: {
    type: String,
    enum: ["beginner", "intermediate", "advanced", "master"],
    default: "beginner",
  },
  estimatedHours: { type: Number, default: 0 },

  // ── Learning Outcomes (shown on course page) ──────────────────────────
  outcomes: [{ type: String }],
  prerequisites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course" }],

  // ── Access Control ─────────────────────────────────────────────────────
  accessLevel: { type: String, enum: ["free", "pro"], default: "pro" },
  isFeatured: { type: Boolean, default: false },
  isPublished: { type: Boolean, default: false },
  publishedAt: { type: Date, default: null },

  // ── Completion & Certification ─────────────────────────────────────────
  completionRules: {
    type: {
      type: String,
      enum: ["all_lessons", "percentage", "final_exam"],
      default: "all_lessons",
    },
    percentage: { type: Number, default: 100 },
    finalExamId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  certificateEnabled: { type: Boolean, default: false },
  certificateTemplate: { type: String, default: "default" },

  // ── Chapters (ordered references) ──────────────────────────────────────
  chapters: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chapter" }],

  // ── Instructor Info ────────────────────────────────────────────────────
  instructor: { type: String, default: "" },
  instructorAvatar: { type: String, default: "" },

  // ── Denormalized Counters ──────────────────────────────────────────────
  totalEnrollments: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  totalLessons: { type: Number, default: 0 },

  // ── Versioning ─────────────────────────────────────────────────────────
  version: { type: Number, default: 1 },

  // ── Metadata ───────────────────────────────────────────────────────────
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Keep updatedAt current
CourseSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

// ── Indexes ──────────────────────────────────────────────────────────────────
CourseSchema.index({ slug: 1 }, { unique: true });
CourseSchema.index({ category: 1, isPublished: 1 });
CourseSchema.index({ accessLevel: 1, isFeatured: 1 });
CourseSchema.index({ difficulty: 1 });
CourseSchema.index({ tags: 1 });
CourseSchema.index({ isPublished: 1, publishedAt: -1 });

const CourseModel = mongoose.model("Course", CourseSchema);

export default CourseModel;
