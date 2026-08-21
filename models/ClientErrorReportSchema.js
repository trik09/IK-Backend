import mongoose from "mongoose";

const errorEntrySchema = new mongoose.Schema(
  {
    message: { type: String },
    stack: { type: String },
    context: { type: String },
    timestamp: { type: Date },
  },
  { _id: false }
);

const ClientErrorReportSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ["exam", "competition", "event", "other"],
      required: true,
      index: true,
    },
    entityId: { type: String, index: true },
    entityName: { type: String },
    itemId: { type: String },
    message: { type: String, required: true, maxlength: 2000 },
    stack: { type: String, maxlength: 8000 },
    userNote: { type: String, maxlength: 2000 },
    capturedErrors: { type: [errorEntrySchema], default: [] },
    url: { type: String, maxlength: 2000 },
    userAgent: { type: String, maxlength: 1000 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    username: { type: String },
    status: {
      type: String,
      enum: ["new", "reviewed", "resolved"],
      default: "new",
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ClientErrorReport", ClientErrorReportSchema);
