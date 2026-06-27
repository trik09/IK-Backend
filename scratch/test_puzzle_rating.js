import mongoose from "mongoose";
import dotenv from "dotenv";
import UserModel from "../models/UserSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";
import PuzzleHistoryModel from "../models/PuzzleHistorySchema.js";
import { recordPuzzleAttempt } from "../utils/puzzleRating.js";

dotenv.config();

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/qcf_dev";

async function runTests() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected.");

  try {
    // Clean up or find/create test user
    const username = "test_rating_user_" + Date.now();
    console.log(`Creating test user: ${username}...`);
    const user = new UserModel({
      name: "Test User",
      username,
      email: `${username}@example.com`,
      password: "password123",
      puzzleRating: 1000,
      puzzleRatingAttempts: 0
    });
    await user.save();

    // Create a couple of test puzzles
    console.log("Creating test puzzles...");
    const puzzle1 = new PuzzleModel({
      title: "Test Puzzle 1024",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      difficulty: "medium",
      rating: 1024,
      category: "Tactics",
      type: "normal"
    });
    await puzzle1.save();

    const puzzle2 = new PuzzleModel({
      title: "Test Puzzle 1100",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      difficulty: "medium",
      rating: 1100,
      category: "Tactics",
      type: "normal"
    });
    await puzzle2.save();

    console.log("--- TEST CASE 1: Solve puzzle1 (1024) with User rating 1000 (Provisional, K=60) ---");
    let res = await recordPuzzleAttempt(user._id, puzzle1._id, true);
    console.log("Result:", res);
    // Expected: E ≈ 0.465, Delta = 60 * (1 - 0.465) = 60 * 0.535 ≈ +32
    // New User Rating = 1032
    if (res.newRating !== 1032) {
      console.error(`FAIL: Expected 1032, got ${res.newRating}`);
    } else {
      console.log("SUCCESS: New rating is 1032");
    }

    console.log("--- TEST CASE 2: Retry same puzzle1 ---");
    res = await recordPuzzleAttempt(user._id, puzzle1._id, true);
    console.log("Result (retry):", res);
    if (res.ratingChanged) {
      console.error("FAIL: Rating updated on a repeat attempt!");
    } else {
      console.log("SUCCESS: Repeat attempt ignored for rating update.");
    }

    console.log("--- TEST CASE 3: Fail puzzle2 (1100) with User rating 1032 (Provisional, K=60) ---");
    res = await recordPuzzleAttempt(user._id, puzzle2._id, false);
    console.log("Result:", res);
    // Ru = 1032, Rp = 1100
    // E = 1 / (1 + 10^((1100 - 1032)/400)) = 1 / (1 + 10^0.17) ≈ 1 / (1 + 1.479) ≈ 0.403
    // Delta = 60 * (0 - 0.403) = -24.18 ≈ -24
    // New rating = 1032 - 24 = 1008
    if (res.newRating !== 1008) {
      console.error(`FAIL: Expected 1008, got ${res.newRating}`);
    } else {
      console.log("SUCCESS: New rating is 1008");
    }

    // Fast-forward attempts to test regular K=32 factor
    console.log("--- TEST CASE 4: Fast forwarding to 10 attempts ---");
    const updatedUser = await UserModel.findById(user._id);
    updatedUser.puzzleRatingAttempts = 10;
    updatedUser.puzzleRating = 1000;
    await updatedUser.save();

    console.log("--- TEST CASE 5: Solve puzzle2 (1100) with User rating 1000 (Attempts=10, K=32) ---");
    // Remove history for puzzle2 to simulate first time attempt
    await PuzzleHistoryModel.deleteOne({ userId: user._id, puzzleId: puzzle2._id });
    
    res = await recordPuzzleAttempt(user._id, puzzle2._id, true);
    console.log("Result (K=32):", res);
    // Ru = 1000, Rp = 1100
    // E = 1 / (1 + 10^((1100-1000)/400)) = 1 / (1 + 10^0.25) ≈ 1 / (1 + 1.778) ≈ 0.36
    // Delta = 32 * (1 - 0.36) = 32 * 0.64 ≈ +20
    // New rating = 1020
    if (res.newRating !== 1020) {
      console.error(`FAIL: Expected 1020, got ${res.newRating}`);
    } else {
      console.log("SUCCESS: New rating is 1020");
    }

    // Clean up test data
    console.log("Cleaning up test data...");
    await UserModel.deleteOne({ _id: user._id });
    await PuzzleModel.deleteOne({ _id: puzzle1._id });
    await PuzzleModel.deleteOne({ _id: puzzle2._id });
    await PuzzleHistoryModel.deleteMany({ userId: user._id });
    console.log("Cleanup complete.");

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Mongoose disconnected.");
  }
}

runTests();
