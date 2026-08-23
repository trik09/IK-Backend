import User from "../models/UserSchema.js";

/**
 * Middleware: Requires authenticated user to have an active QCFY Pro membership.
 * Must be placed AFTER isUser middleware in the middleware chain.
 *
 * Usage:  router.get("/pro-content", isUser, isPro, handler);
 */
const isPro = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated", code: "NO_AUTH" });
    }

    const membership = req.user.membership;

    // Check plan
    if (!membership || membership.plan !== "pro") {
      return res.status(403).json({
        message: "QCFY Pro membership required to access this feature.",
        code: "PRO_REQUIRED",
      });
    }

    // Check status
    if (membership.status !== "active") {
      return res.status(403).json({
        message: "Your QCFY Pro membership has expired. Please renew to continue.",
        code: "PRO_EXPIRED",
      });
    }

    // Check expiry date (if set)
    if (membership.expiresAt && new Date(membership.expiresAt) < new Date()) {
      // Auto-expire the membership
      await User.findByIdAndUpdate(req.user._id, {
        "membership.status": "expired",
        "membership.plan": "free",
      });

      return res.status(403).json({
        message: "Your QCFY Pro membership has expired. Please renew to continue.",
        code: "PRO_EXPIRED",
      });
    }

    next();
  } catch (err) {
    console.error("isPro middleware error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default isPro;
