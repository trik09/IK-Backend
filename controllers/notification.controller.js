import NotificationModel from "../models/NotificationSchema.js";

/**
 * Admin: Create and broadcast notification
 */
export const createNotification = async (req, res) => {
  try {
    const { title, description, link, ctaText, type } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: "Description is required" });
    }

    const notification = await NotificationModel.create({
      title: title.trim(),
      description: description.trim(),
      link: link && link.trim() ? link.trim() : null,
      ctaText: ctaText && ctaText.trim() ? ctaText.trim() : "View",
      type: type || "feature",
      createdBy: req.admin?._id || req.user?._id,
      readBy: []
    });

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      notification
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create notification",
      error: error.message
    });
  }
};

/**
 * Admin: Get all notifications with stats
 */
export const getAdminNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const total = await NotificationModel.countDocuments();
    const notifications = await NotificationModel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formatted = notifications.map((n) => ({
      ...n,
      readCount: Array.isArray(n.readBy) ? n.readBy.length : 0
    }));

    return res.status(200).json({
      success: true,
      notifications: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("Error fetching admin notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message
    });
  }
};

/**
 * Admin: Delete notification
 */
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await NotificationModel.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      error: error.message
    });
  }
};

/**
 * Public / User: Get active notifications
 */
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user?._id;

    const notifications = await NotificationModel.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    let unreadCount = 0;
    const formatted = notifications.map((n) => {
      const isRead = userId
        ? (n.readBy || []).some((r) => r.toString() === userId.toString())
        : false;

      if (!isRead) unreadCount++;

      return {
        _id: n._id,
        title: n.title,
        description: n.description,
        link: n.link,
        ctaText: n.ctaText || "View",
        type: n.type,
        createdAt: n.createdAt,
        isRead
      };
    });

    return res.status(200).json({
      success: true,
      notifications: formatted,
      unreadCount
    });
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message
    });
  }
};

/**
 * User: Mark single notification as read
 */
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { id } = req.params;

    if (!userId) {
      return res.status(200).json({ success: true, message: "Acknowledged for guest" });
    }

    await NotificationModel.findByIdAndUpdate(id, {
      $addToSet: { readBy: userId }
    });

    return res.status(200).json({
      success: true,
      message: "Marked as read"
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark as read",
      error: error.message
    });
  }
};

/**
 * User: Mark all notifications as read
 */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(200).json({ success: true, message: "Acknowledged for guest" });
    }

    await NotificationModel.updateMany(
      { isActive: true, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to mark all as read",
      error: error.message
    });
  }
};
