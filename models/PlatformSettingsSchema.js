import mongoose from "mongoose";

const PlatformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "global" },
    showReportIssueButton: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("PlatformSettings", PlatformSettingsSchema);
