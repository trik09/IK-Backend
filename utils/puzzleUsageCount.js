import PuzzleModel from "../models/PuzzleSchema.js";

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
    [
      {
        $set: {
          competitionUsageCount: {
            $max: [
              { $subtract: [{ $ifNull: ["$competitionUsageCount", 0] }, 1] },
              0,
            ],
          },
        },
      },
    ]
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
