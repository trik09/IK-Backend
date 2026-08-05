import PuzzleModel from "../models/PuzzleSchema.js";
import mongoose from "mongoose";

export function getPuzzleIdsFromCompetition(competition) {
  if (!competition) return [];

  const fromPuzzles = (competition.puzzles || []).map(String);
  const fromChapters = (competition.chapters || []).flatMap((ch) =>
    (ch.puzzleIds || []).map(String)
  );

  return [...new Set([...fromPuzzles, ...fromChapters])];
}

export async function incrementPuzzleUsageCounts(puzzleIds = []) {
  const uniqueIds = [...new Set(puzzleIds.map(String).filter(Boolean))];
  if (!uniqueIds.length) return;

  await PuzzleModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $inc: { competitionUsageCount: 1 } }
  );
}

export async function decrementPuzzleUsageCounts(puzzleIds = []) {
  const uniqueIds = [...new Set(puzzleIds.map(String).filter(Boolean))];
  if (!uniqueIds.length) return;

  await PuzzleModel.updateMany(
    { _id: { $in: uniqueIds } },
    { $inc: { competitionUsageCount: -1 } }
  );

  // Clamp to 0 — never go negative
  await PuzzleModel.updateMany(
    { _id: { $in: uniqueIds }, competitionUsageCount: { $lt: 0 } },
    { $set: { competitionUsageCount: 0 } }
  );
}

export async function syncPuzzleUsageCounts(oldIds = [], newIds = []) {
  const oldSet = new Set(oldIds.map(String));
  const newSet = new Set(newIds.map(String));

  const added = [...newSet].filter((id) => !oldSet.has(id));
  const removed = [...oldSet].filter((id) => !newSet.has(id));

  await Promise.all([
    incrementPuzzleUsageCounts(added),
    decrementPuzzleUsageCounts(removed),
  ]);
}

/**
 * Full recompute of competitionUsageCount for a set of puzzle IDs.
 * Counts actual appearances across both competition.puzzles (ObjectId[])
 * and competition.chapters[].puzzleIds (String[]).
 *
 * Used on-demand to repair stale counts without a full collection scan.
 * Called when the API detects a mismatch (optional, not in the hot path).
 */
export async function recomputeUsageCountsForIds(puzzleIds = []) {
  if (!puzzleIds.length) return;

  const hexIds = [...new Set(puzzleIds.map(String).filter(Boolean))];
  const objectIds = hexIds.map((h) => new mongoose.Types.ObjectId(h));

  // Count actual occurrences in Competition collection for each puzzle
  const CompetitionModel = (await import("../models/CompetitionSchema.js")).default;

  const counts = await CompetitionModel.aggregate([
    {
      $project: {
        allIds: {
          $concatArrays: [
            { $ifNull: ["$puzzles", []] },
            {
              $reduce: {
                input: { $ifNull: ["$chapters", []] },
                initialValue: [],
                in: { $concatArrays: ["$$value", { $ifNull: ["$$this.puzzleIds", []] }] },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$allIds" },
    { $group: { _id: { $toString: "$allIds" }, count: { $sum: 1 } } },
    { $match: { _id: { $in: hexIds } } },
  ]);

  const countMap = new Map(counts.map((c) => [c._id, c.count]));

  // Build bulk writes: set each puzzle to its real count (0 if not found)
  const bulkOps = hexIds.map((hex) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(hex) },
      update: { $set: { competitionUsageCount: countMap.get(hex) ?? 0 } },
    },
  }));

  if (bulkOps.length) {
    await PuzzleModel.bulkWrite(bulkOps, { ordered: false });
  }
}
