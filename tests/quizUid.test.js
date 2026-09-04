import { test, describe, before, after, beforeEach } from "node:test";
import assert from "assert";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import QuizModel from "../models/QuizSchema.js";
import QuizCategoryModel from "../models/QuizCategorySchema.js";
import { ensureAllQuizzesHaveUid } from "../controllers/quiz.controller.js";
import {
  generateRandomUid,
  isUidDuplicateKeyError,
  saveQuizWithRetry,
} from "../utils/quizUidHelper.js";

describe("Quiz UID Uniqueness and Collision Handling Tests", () => {
  let categoryId;

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    // Clean up any old test quizzes first
    await QuizModel.deleteMany({ questionText: /^TEST_UID_/ });
    // Ensure all quizzes have UID and sync unique index
    await ensureAllQuizzesHaveUid();

    let cat = await QuizCategoryModel.findOne();
    if (!cat) {
      cat = await QuizCategoryModel.create({ name: "UID Test Category" });
    }
    categoryId = cat._id;
  });

  after(async () => {
    // Clean up created test quizzes
    await QuizModel.deleteMany({ questionText: /^TEST_UID_/ });
  });

  test("1. UID format must be QZ + 5 hexadecimal characters", async () => {
    const quiz = await saveQuizWithRetry({
      type: "mcq",
      questionText: "TEST_UID_Format Check",
      category: categoryId,
      options: [{ text: "Option A", isCorrect: true }],
    });

    assert.ok(quiz.uid, "Quiz should have a UID");
    assert.match(quiz.uid, /^QZ[0-9A-F]{5}$/, "UID must match format QZ + 5 hex characters");

    // Clean up
    await QuizModel.findByIdAndDelete(quiz._id);
  });

  test("2. Existing valid UIDs MUST NOT be regenerated or changed on save/update", async () => {
    const customUid = "QZ99999";
    const quiz = await saveQuizWithRetry({
      uid: customUid,
      type: "mcq",
      questionText: "TEST_UID_Preserve Custom UID",
      category: categoryId,
      options: [{ text: "Option 1", isCorrect: true }],
    });

    assert.strictEqual(quiz.uid, customUid, "Original UID must be preserved");

    // Update quiz question text
    quiz.questionText = "TEST_UID_Preserve Custom UID Updated";
    await saveQuizWithRetry(quiz);

    const reloaded = await QuizModel.findById(quiz._id);
    assert.strictEqual(reloaded.uid, customUid, "UID must remain unchanged after update");

    await QuizModel.findByIdAndDelete(quiz._id);
  });

  test("3. E11000 collision retry handling must automatically generate new UID and save successfully", async () => {
    const firstQuiz = await saveQuizWithRetry({
      type: "mcq",
      questionText: "TEST_UID_First Collision Doc",
      category: categoryId,
      options: [{ text: "Yes", isCorrect: true }],
    });

    // Attempt to save a second quiz explicitly forcing the exact same UID as firstQuiz to simulate collision
    const conflictingQuizData = {
      uid: firstQuiz.uid, // Force duplicate UID
      type: "mcq",
      questionText: "TEST_UID_Second Colliding Doc",
      category: categoryId,
      options: [{ text: "No", isCorrect: true }],
    };

    const secondQuiz = await saveQuizWithRetry(conflictingQuizData);

    assert.ok(secondQuiz._id, "Second quiz must be saved successfully");
    assert.notStrictEqual(secondQuiz.uid, firstQuiz.uid, "Second quiz must receive a new non-colliding UID");
    assert.match(secondQuiz.uid, /^QZ[0-9A-F]{5}$/, "New UID must match QZ + 5 hex format");

    await QuizModel.findByIdAndDelete(firstQuiz._id);
    await QuizModel.findByIdAndDelete(secondQuiz._id);
  });

  test("4. Concurrent quiz creation is safe without duplicate key failures", async () => {
    const creationPromises = Array.from({ length: 10 }).map((_, idx) =>
      saveQuizWithRetry({
        type: "mcq",
        questionText: `TEST_UID_Concurrent Creation ${idx}`,
        category: categoryId,
        options: [{ text: `Ans ${idx}`, isCorrect: true }],
      })
    );

    const savedQuizzes = await Promise.all(creationPromises);
    assert.strictEqual(savedQuizzes.length, 10, "All 10 concurrent quizzes must save");

    const uids = savedQuizzes.map((q) => q.uid);
    const uniqueUids = new Set(uids);
    assert.strictEqual(uniqueUids.size, 10, "All concurrent quizzes must have distinct UIDs");

    // Clean up
    const ids = savedQuizzes.map((q) => q._id);
    await QuizModel.deleteMany({ _id: { $in: ids } });
  });

  test("5. Helper isUidDuplicateKeyError correctly identifies UID duplicate key errors", () => {
    const uidErr = {
      code: 11000,
      keyPattern: { uid: 1 },
      message: "E11000 duplicate key error collection: test.quizzes index: uid_1 dup key: { uid: \"QZ12345\" }",
    };

    const otherErr = {
      code: 11000,
      keyPattern: { email: 1 },
      message: "E11000 duplicate key error collection: test.users index: email_1 dup key: { email: \"a@b.com\" }",
    };

    assert.strictEqual(isUidDuplicateKeyError(uidErr), true);
    assert.strictEqual(isUidDuplicateKeyError(otherErr), false);
    assert.strictEqual(isUidDuplicateKeyError(null), false);
  });

  test("6. Startup migration and index sync guarantee unique index and backfill missing UIDs", async () => {
    // Run ensureAllQuizzesHaveUid
    await ensureAllQuizzesHaveUid();

    // Check indexes on quizzes collection
    const indexes = await QuizModel.collection.indexes();
    const uidIndex = indexes.find((idx) => idx.key && idx.key.uid === 1);

    assert.ok(uidIndex, "uid index must exist");
    assert.strictEqual(uidIndex.unique, true, "uid index MUST be unique");
    assert.strictEqual(uidIndex.sparse, true, "uid index MUST be sparse");
  });
});
