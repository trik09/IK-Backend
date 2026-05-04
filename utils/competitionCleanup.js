import CompetitionModel from "../models/CompetitionSchema.js";

/**
 * Deletes only Competition documents that are older than RETENTION_DAYS days
 * (measured from createdAt) and have status "ENDED".
 *
 * Participant, PuzzleAttempt, and all other related records are intentionally
 * left untouched so admins retain full historical data.
 */
const RETENTION_DAYS = 30;

export async function deleteOldCompetitions() {
  const cutoff = new Date();
  //console.log(cutoff);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  console.log(
    `[CompetitionCleanup] Running cleanup — removing ENDED competitions created before ${cutoff.toISOString()}`
  );

  try {
    // Fetch matching competitions first so we can log each one before deletion
    const toDelete = await CompetitionModel.find(
      {
        status: "ENDED",
        createdAt: { $lt: cutoff },
      },
      { _id: 1, name: 1, createdAt: 1 }
    ).lean();

    if (toDelete.length === 0) {
      console.log("[CompetitionCleanup] No expired competitions found. Nothing to delete.");
      return { deleted: 0 };
    }

    const ids = toDelete.map((c) => c._id);

    toDelete.forEach((c) =>
      console.log(
        `[CompetitionCleanup]  → Deleting "${c.name}" (id: ${c._id}, created: ${c.createdAt.toISOString()})`
      )
    );

    // Delete only the competition documents — participants/attempts are kept
    const result = await CompetitionModel.deleteMany({ _id: { $in: ids } });

    console.log(
      `[CompetitionCleanup] ✓ Deleted ${result.deletedCount} competition(s). Participant data preserved.`
    );

    return { deleted: result.deletedCount };
  } catch (error) {
    console.error("[CompetitionCleanup] ✗ Cleanup failed:", error.message);
    throw error;
  }
}
