import crypto from "crypto";
import QuizModel from "../models/QuizSchema.js";

/**
 * Generate a UID string in format QZ + 5 hexadecimal characters (uppercase).
 * @returns {string} e.g. "QZ83F21"
 */
export function generateRandomUid() {
  const hexPart = crypto.randomBytes(3).toString("hex").slice(0, 5).toUpperCase();
  return `QZ${hexPart}`;
}

/**
 * Check whether a MongoDB error is an E11000 duplicate key error specifically for the 'uid' field.
 * @param {Error} error
 * @returns {boolean}
 */
export function isUidDuplicateKeyError(error) {
  if (!error) return false;
  const isE11000 =
    error.code === 11000 ||
    error.name === "MongoServerError" ||
    (typeof error.message === "string" && error.message.includes("E11000"));

  if (!isE11000) return false;

  // Check if keyPattern or keyValue specifies uid
  if (error.keyPattern && error.keyPattern.uid !== undefined) return true;
  if (error.keyValue && error.keyValue.uid !== undefined) return true;

  const msg = error.message || error.errmsg || "";
  if (msg.includes("uid_1") || msg.includes("uid")) return true;

  return false;
}

/**
 * Save a quiz document with automatic retry if a UID collision occurs.
 * Does not alter existing valid UIDs if quiz already has one.
 * Safe for concurrent quiz creation.
 *
 * @param {import("mongoose").Document | Object} quizDocOrData - Mongoose document or data object
 * @param {number} [maxRetries=10]
 * @returns {Promise<import("mongoose").Document>} Saved quiz document
 */
export async function saveQuizWithRetry(quizDocOrData, maxRetries = 10) {
  let attempts = 0;
  let doc = quizDocOrData instanceof QuizModel ? quizDocOrData : new QuizModel(quizDocOrData);

  while (attempts < maxRetries) {
    try {
      return await doc.save();
    } catch (error) {
      if (isUidDuplicateKeyError(error) && attempts < maxRetries - 1) {
        attempts++;
        const newUid = generateRandomUid();
        console.warn(
          `[QuizUID] Duplicate UID collision detected (${doc.uid}). Retrying with new UID: ${newUid} (Attempt ${attempts}/${maxRetries})`
        );
        doc.uid = newUid;
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to save quiz after ${maxRetries} attempts due to repeated UID collisions.`);
}
