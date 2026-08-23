import Feedback from "../models/FeedbackSchema.js";

export const createFeedback = async (req, res) => {
  try {
    const { rating, category, message } = req.body;
    if (!rating || !message) {
      return res.status(400).json({ success: false, message: "Rating and message are required." });
    }

    const feedback = await Feedback.create({
      user: req.user._id,
      rating,
      category: category || "General",
      message,
    });

    return res.status(201).json({
      success: true,
      message: "Thank you for your feedback!",
      data: feedback,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminFeedbacks = async (req, res) => {
  try {
    const feedbacks = await Feedback.find()
      .populate("user", "name email username avatar")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: feedbacks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
