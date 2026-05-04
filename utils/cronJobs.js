import cron from "node-cron";
import { deleteOldCompetitions } from "./competitionCleanup.js";

/**
 * Registers all scheduled cron jobs for the application.
 * Call this once after the DB connection is established.
 *
 * Schedule syntax: second(optional) minute hour day month weekday
 */
export function initCronJobs() {
  // ─── Competition cleanup ───────────────────────────────────────────────────
  // Runs every day at midnight (00:00) server time.
  // Deletes ENDED competitions that are older than 30 days.
  cron.schedule(
    "0 0 * * *", // minute=0, hour=0 → 00:00 every day
    async () => {
      console.log("[Cron] Midnight competition cleanup triggered.");
      try {
        await deleteOldCompetitions();
      } catch (err) {
        console.error("[Cron] Competition cleanup error:", err.message);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata", // IST — change to your server timezone if needed
    }
  );

  console.log("[Cron] Jobs registered: competition cleanup @ 00:00 IST daily.");
}
