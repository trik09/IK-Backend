import mongoose from "mongoose";

const CoachInquirySchema = new mongoose.Schema(
  {
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coach",
      required: true,
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    whatsapp: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
    age: {
      type: Number,
    },
    currentRating: {
      type: Number,
      default: 0,
    },
    targetRating: {
      type: Number,
      default: 0,
    },
    playingLevel: {
      type: String,
      trim: true,
    },
    preferredLanguage: {
      type: String,
      trim: true,
    },
    preferredTime: {
      type: String,
      trim: true,
    },
    classType: {
      type: String,
      enum: ["Online", "Offline", "Both"],
      default: "Online",
    },
    classesRequired: {
      type: Number,
      default: 1,
    },
    goals: {
      type: String,
      trim: true,
    },
    additionalNotes: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "contacted", "assigned", "completed", "rejected"],
      default: "pending",
    },
    internalNotes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("CoachInquiry", CoachInquirySchema);
