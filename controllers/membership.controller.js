import User from "../models/UserSchema.js";
import { getPaymentAdapter } from "../services/payment/paymentAdapter.js";

/**
 * POST /api/membership/upgrade
 * Upgrade the authenticated user to QCFY Pro.
 * Phase 1: Uses SimulatedPaymentAdapter (instant success).
 */
export const upgradeToPro = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Already Pro?
    if (user.membership?.plan === "pro" && user.membership?.status === "active") {
      return res.status(400).json({
        success: false,
        message: "You already have an active QCFY Pro membership.",
      });
    }

    // Create order via payment adapter
    const adapter = getPaymentAdapter();
    const order = await adapter.createOrder(userId, "pro");

    if (!order.success) {
      return res.status(500).json({ success: false, message: "Failed to create payment order." });
    }

    // Verify payment (simulated = always success)
    const verification = await adapter.verifyPayment(order.orderId);

    if (!verification.success || !verification.verified) {
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    // Activate Pro membership
    const now = new Date();
    const historyEntry = {
      plan: "pro",
      provider: order.provider || "simulated",
      orderId: order.orderId,
      activatedAt: now,
      expiresAt: null, // Lifetime for simulated
    };

    user.membership = {
      plan: "pro",
      activatedAt: now,
      expiresAt: null,
      status: "active",
      provider: order.provider || "simulated",
      orderId: order.orderId,
      history: [...(user.membership?.history || []), historyEntry],
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Welcome to QCFY Pro! Your membership is now active.",
      membership: {
        plan: user.membership.plan,
        status: user.membership.status,
        activatedAt: user.membership.activatedAt,
        expiresAt: user.membership.expiresAt,
        provider: user.membership.provider,
      },
    });
  } catch (err) {
    console.error("upgradeToPro error:", err);
    return res.status(500).json({ success: false, message: "Server error during upgrade." });
  }
};

/**
 * GET /api/membership/status
 * Returns the current membership status of the authenticated user.
 */
export const getMembershipStatus = async (req, res) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      membership: {
        plan: user.membership?.plan || "free",
        status: user.membership?.status || "active",
        activatedAt: user.membership?.activatedAt || null,
        expiresAt: user.membership?.expiresAt || null,
        provider: user.membership?.provider || null,
      },
      isPro: user.membership?.plan === "pro" && user.membership?.status === "active",
    });
  } catch (err) {
    console.error("getMembershipStatus error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/membership/cancel
 * Cancel the user's Pro membership.
 */
export const cancelMembership = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user || user.membership?.plan !== "pro") {
      return res.status(400).json({ success: false, message: "No active Pro membership found." });
    }

    // Cancel via adapter
    const adapter = getPaymentAdapter();
    await adapter.cancelSubscription(user.membership.orderId);

    // Update membership
    const cancelHistory = {
      plan: "pro",
      provider: user.membership.provider,
      orderId: user.membership.orderId,
      activatedAt: user.membership.activatedAt,
      expiresAt: user.membership.expiresAt,
      cancelledAt: new Date(),
    };

    user.membership.plan = "free";
    user.membership.status = "cancelled";
    user.membership.history = [...(user.membership.history || []), cancelHistory];

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Your QCFY Pro membership has been cancelled.",
    });
  } catch (err) {
    console.error("cancelMembership error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
