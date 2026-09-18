import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  link: {
    type: String,
    default: null,
    trim: true
  },
  ctaText: {
    type: String,
    default: "View",
    trim: true,
    maxlength: 40
  },
  type: {
    type: String,
    enum: ["feature", "announcement", "event", "update", "general"],
    default: "feature"
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ isActive: 1, createdAt: -1 });

const NotificationModel = mongoose.model("Notification", NotificationSchema);

export default NotificationModel;
