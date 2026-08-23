import mongoose from "mongoose";

const EnrollmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
  status: {
    type: String,
    enum: ["active", "completed", "paused"],
    default: "active",
  },
  progress: { type: Number, default: 0, min: 0, max: 100 }, // 0-100 percentage
  enrolledAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  lastAccessedAt: { type: Date, default: Date.now },
  lastLessonId: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", default: null },
  lastBlockId: { type: mongoose.Schema.Types.ObjectId, default: null }, // Resume at exact block
  certificateId: { type: String, default: null },
  xpEarned: { type: Number, default: 0 },
});

// A user can only enroll once per course
EnrollmentSchema.index({ user: 1, course: 1 }, { unique: true });
EnrollmentSchema.index({ user: 1, status: 1 });
EnrollmentSchema.index({ course: 1 });

const EnrollmentModel = mongoose.model("Enrollment", EnrollmentSchema);

export default EnrollmentModel;
