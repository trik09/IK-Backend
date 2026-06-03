import mongoose from "mongoose";

// Prize tier within a pricing category
const PrizeTierSchema = new mongoose.Schema({
  rank: { type: Number, required: true },       // 1, 2, 3, ...
  description: { type: String, default: "" },   // "Gold Medal", "₹500 voucher", etc.
  amount: { type: Number, default: 0 },         // Cash prize (0 = no cash)
}, { _id: false });

// Pricing category — can be age-group scoped or "Overall"
const PricingCategorySchema = new mongoose.Schema({
  label: { type: String, required: true },      // "U9", "U14", "Open", "Overall"
  ageMin: { type: Number, default: null },       // null = no min
  ageMax: { type: Number, default: null },       // null = no max
  prizes: [PrizeTierSchema],
}, { _id: true });

const EventSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,

  // Event timing (overall window — individual round timings come from linked Competitions)
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  duration: { type: Number },                   // total minutes (informational)

  // Event settings
  maxParticipants: { type: Number },
  isActive: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING"
  },

  // Prize Configuration
  pricing: [PricingCategorySchema],

  // Access Control
  accessCode: { type: String },

  // Entry Fee & Payments
  entryFeeType: { type: String, enum: ["free", "paid"], default: "free" },
  entryFeeAmount: { type: Number, default: 0 },
  qrCodeUrl: { type: String, default: "" },

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for faster queries
EventSchema.index({ status: 1, startTime: 1 });
EventSchema.index({ status: 1, endTime: 1 });
EventSchema.index({ startTime: 1, endTime: 1 });
EventSchema.index({ isActive: 1 });

const EventModel = mongoose.model("Event", EventSchema);

export default EventModel;
