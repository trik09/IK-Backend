/**
 * Payment Gateway Adapter Interface
 * ──────────────────────────────────
 * All payment adapters must implement:
 *   createOrder(userId, plan, options)  → { success, orderId, amount, currency }
 *   verifyPayment(orderId, payload)     → { success, verified }
 *   cancelSubscription(orderId)         → { success }
 *   getReceipt(orderId)                 → { success, receipt }
 *
 * Adapter selection via env: PAYMENT_PROVIDER=simulated|stripe|razorpay|cashfree
 */

// ─── Simulated Payment Adapter (Phase 1) ────────────────────────────────────
class SimulatedPaymentAdapter {
  async createOrder(userId, plan, options = {}) {
    const orderId = `SIM_${Date.now()}_${userId.toString().slice(-6)}`;
    return {
      success: true,
      orderId,
      amount: plan === "pro" ? 999 : 0, // ₹999 simulated price
      currency: "INR",
      provider: "simulated",
      message: "Simulated order created successfully",
    };
  }

  async verifyPayment(orderId, payload = {}) {
    // Simulated adapter always verifies successfully
    return {
      success: true,
      verified: true,
      orderId,
      message: "Simulated payment verified successfully",
    };
  }

  async cancelSubscription(orderId) {
    return {
      success: true,
      orderId,
      message: "Simulated subscription cancelled",
    };
  }

  async getReceipt(orderId) {
    return {
      success: true,
      receipt: {
        orderId,
        provider: "simulated",
        amount: 999,
        currency: "INR",
        status: "paid",
        paidAt: new Date().toISOString(),
      },
    };
  }
}

// ─── Stripe Adapter Stub (Future) ───────────────────────────────────────────
class StripePaymentAdapter {
  async createOrder() { throw new Error("Stripe adapter not yet implemented"); }
  async verifyPayment() { throw new Error("Stripe adapter not yet implemented"); }
  async cancelSubscription() { throw new Error("Stripe adapter not yet implemented"); }
  async getReceipt() { throw new Error("Stripe adapter not yet implemented"); }
}

// ─── Razorpay Adapter Stub (Future) ─────────────────────────────────────────
class RazorpayPaymentAdapter {
  async createOrder() { throw new Error("Razorpay adapter not yet implemented"); }
  async verifyPayment() { throw new Error("Razorpay adapter not yet implemented"); }
  async cancelSubscription() { throw new Error("Razorpay adapter not yet implemented"); }
  async getReceipt() { throw new Error("Razorpay adapter not yet implemented"); }
}

// ─── Cashfree Adapter Stub (Future) ─────────────────────────────────────────
class CashfreePaymentAdapter {
  async createOrder() { throw new Error("Cashfree adapter not yet implemented"); }
  async verifyPayment() { throw new Error("Cashfree adapter not yet implemented"); }
  async cancelSubscription() { throw new Error("Cashfree adapter not yet implemented"); }
  async getReceipt() { throw new Error("Cashfree adapter not yet implemented"); }
}

// ─── Factory ────────────────────────────────────────────────────────────────
const ADAPTERS = {
  simulated: SimulatedPaymentAdapter,
  stripe: StripePaymentAdapter,
  razorpay: RazorpayPaymentAdapter,
  cashfree: CashfreePaymentAdapter,
};

let _instance = null;

export function getPaymentAdapter() {
  if (_instance) return _instance;
  const provider = (process.env.PAYMENT_PROVIDER || "simulated").toLowerCase();
  const AdapterClass = ADAPTERS[provider] || SimulatedPaymentAdapter;
  _instance = new AdapterClass();
  console.log(`[Payment] Using ${provider} payment adapter`);
  return _instance;
}

export default getPaymentAdapter;
