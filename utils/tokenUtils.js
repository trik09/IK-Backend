import crypto from "crypto";
import jwt from "jsonwebtoken";

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Generate a short-lived access token (15 minutes).
 */
export function generateAccessToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30m" });
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
 * 
 * Automatically detects localhost requests and adjusts cookie settings accordingly.
 * No need to change FRONTEND_URL in .env for local development!
 */
export function getRefreshCookieOptions(req = null) {
  // Auto-detect localhost from request origin/referer
  let isLocalhost = false;
  
  if (req) {
    const origin = req.headers?.origin || req.headers?.referer || '';
    isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  }
  
  // If no request context, fall back to FRONTEND_URL check
  if (!req) {
    const frontendUrl = process.env.FRONTEND_URL || '';
    isLocalhost = frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1');
  }
  
  // For localhost: use relaxed settings (secure=false, sameSite=lax)
  // For production: use strict settings (secure=true, sameSite=none)
  return {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: isLocalhost ? "lax" : "none",
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}
