import QuizModel from "../models/QuizSchema.js";
import mongoose from "mongoose";

export function getQuizIdsFromExam(exam) {
  if (!exam) return [];

  return [
    ...new Set(
      (exam.chapters || []).flatMap((ch) =>
        (ch.quizIds || []).map(String).filter(Boolean),
      ),
    ),
  ];
}

export async function incrementQuizUsageCounts(quizIds = []) {
  const uniqueIds = [...new Set(quizIds.map(String).filter(Boolean))];
  if (!uniqueIds.length) return;

  await QuizModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $inc: { examUsageCount: 1 } },
  );
}

export async function decrementQuizUsageCounts(quizIds = []) {
  const uniqueIds = [...new Set(quizIds.map(String).filter(Boolean))];
  if (!uniqueIds.length) return;

  await QuizModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $inc: { examUsageCount: -1 } },
  );

  await QuizModel.updateMany(
    { _id: { $in: uniqueIds }, examUsageCount: { $lt: 0 } },
    { $set: { examUsageCount: 0 } },
  );
}

export async function syncQuizUsageCounts(oldIds = [], newIds = []) {
  const oldSet = new Set(oldIds.map(String));
  const newSet = new Set(newIds.map(String));

  const added = [...newSet].filter((id) => !oldSet.has(id));
  const removed = [...oldSet].filter((id) => !newSet.has(id));

  await Promise.all([
    incrementQuizUsageCounts(added),
    decrementQuizUsageCounts(removed),
  ]);
}

/**
 * Full recompute of examUsageCount for a set of quiz IDs from Exam.chapters[].quizIds.
 */
export async function recomputeQuizUsageCountsForIds(quizIds = []) {
  if (!quizIds.length) return;

  const hexIds = [...new Set(quizIds.map(String).filter(Boolean))];
  const ExamModel = (await import("../models/ExamSchema.js")).default;

  const counts = await ExamModel.aggregate([
    { $unwind: { path: "$chapters", preserveNullAndEmptyArrays: false } },
    { $unwind: { path: "$chapters.quizIds", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: { $toString: "$chapters.quizIds" },
        count: { $sum: 1 },
      },
    },
    { $match: { _id: { $in: hexIds } } },
  ]);

  const countMap = new Map(counts.map((c) => [c._id, c.count]));

  const bulkOps = hexIds.map((hex) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(hex) },
      update: { $set: { examUsageCount: countMap.get(hex) ?? 0 } },
    },
  }));

  if (bulkOps.length) {
    await QuizModel.bulkWrite(bulkOps, { ordered: false });
  }
}
