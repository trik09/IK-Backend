import mongoose from "mongoose";

const CoachSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    mobile: {
      type: String,
      trim: true,
    },
    whatsapp: {
      type: String,
      trim: true,
    },
    profilePhoto: {
      type: String,
      default: "",
    },
    coverImage: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    languages: [
      {
        type: String,
        trim: true,
      },
    ],
    chessTitle: {
      type: String,
      enum: ["GM", "IM", "FM", "CM", "NM", "None"],
      default: "None",
    },
    fideRating: {
      type: Number,
      default: 0,
    },
    chessComRating: {
      type: Number,
      default: 0,
    },
    lichessRating: {
      type: Number,
      default: 0,
    },
    experienceYears: {
      type: Number,
      required: true,
      default: 0,
    },
    specializations: [
      {
        type: String,
        trim: true,
      },
    ],
    shortBio: {
      type: String,
      required: true,
      trim: true,
    },
    about: {
      type: String,
      required: true,
      trim: true,
    },
    coachingStyle: {
      type: String,
      trim: true,
    },
    hourlyFee: {
      type: Number,
      required: true,
      default: 0,
    },
    monthlyPackage: {
      type: String,
      trim: true,
    },
    availableDays: [
      {
        type: String,
        trim: true,
      },
    ],
    availableTimeSlots: [
      {
        type: String,
        trim: true,
      },
    ],
    timeZone: {
      type: String,
      trim: true,
    },
    demoAvailable: {
      type: Boolean,
      default: false,
    },
    studentsCoached: {
      type: Number,
      default: 0,
    },
    achievements: [
      {
        type: String,
        trim: true,
      },
    ],
    certificates: [
      {
        type: String,
        trim: true,
      },
    ],
    resumeUrl: {
      type: String,
      default: "",
    },
    socialLinks: {
      youtube: { type: String, default: "" },
      instagram: { type: String, default: "" },
      chessCom: { type: String, default: "" },
      lichess: { type: String, default: "" },
      website: { type: String, default: "" },
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    internalNotes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Coach", CoachSchema);
