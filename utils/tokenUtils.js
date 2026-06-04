import jwt from "jsonwebtoken";

const TOKEN_EXPIRY = "60d";

/**
 * Generate a long-lived access token (60 days).
 */
export function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Keep legacy alias so nothing breaks if generateAccessToken is called elsewhere
export const generateAccessToken = generateToken;
