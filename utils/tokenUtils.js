import crypto from "crypto";
import jwt from "jsonwebtoken";

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Generate a short-lived access token (15 minutes).
 */
export function generateAccessToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "15m" });
}

/**
 * Generate a cryptographically random refresh token string.
 * Returns { raw, expiry }
 *   raw    — the plain token to store in the httpOnly cookie
 *   expiry — Date object (now + 7 days)
 */
export function generateRefreshToken() {
  const raw = crypto.randomBytes(64).toString("hex");
  const expiry = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return { raw, expiry };
}

/**
 * Hash a refresh token before storing it in the DB (SHA-256).
 * This way a DB leak doesn't expose usable tokens.
 */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Cookie options for the refresh token.
 * httpOnly  — JS cannot read it (XSS protection)
 * secure    — only sent over HTTPS in production
 * sameSite  — CSRF protection
 * maxAge    — 7 days in milliseconds
 */
export function getRefreshCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  const isLocalDev = !process.env.FRONTEND_URL?.startsWith("https");

  return {
    httpOnly: true,
    // secure must be true when SameSite=none (required by browsers)
    // In local dev with http, use false + lax so cookies work via Vite proxy
    secure: !isLocalDev,
    sameSite: isLocalDev ? "lax" : "none",
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}
