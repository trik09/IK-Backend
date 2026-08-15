import cron from "node-cron";
import { deleteOldCompetitions } from "./competitionCleanup.js";
import { rotateDailyQuote } from "../controllers/quote.controller.js";
import CompetitionModel from "../models/CompetitionSchema.js";
import ExamModel from "../models/ExamSchema.js";
import { ensureCompetitionEnded } from "./socketHandlers.js";
import { scheduleExamEnd } from "./socketExamHandlers.js";

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

  // ─── Daily quote rotation ───────────────────────────────────────────────────
  // Runs every day at midnight (00:00) server time.
  // Rotates to a new random quote for the day.
  cron.schedule(
    "0 0 * * *", // minute=0, hour=0 → 00:00 every day
    async () => {
      console.log("[Cron] Daily quote rotation triggered.");
      try {
        await rotateDailyQuote();
      } catch (err) {
        console.error("[Cron] Daily quote rotation error:", err.message);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata", // IST — change to your server timezone if needed
    }
  );

  cron.schedule(
    "* * * * *",
    async () => {
      const now = new Date();
      try {
        const expiredCompetitions = await CompetitionModel.find({
          status: { $in: ["LIVE", "live"] },
          endTime: { $lte: now },
        })
          .select("_id")
          .lean();
        for (const competition of expiredCompetitions) {
          await ensureCompetitionEnded(competition._id);
        }
      } catch (err) {
        console.error("[Cron] Competition end sweep error:", err.message);
      }

      try {
        const expiredExams = await ExamModel.find({
          status: "LIVE",
          endTime: { $lte: now },
        })
          .select("_id endTime")
          .lean();
        for (const exam of expiredExams) {
          scheduleExamEnd(exam._id, exam.endTime);
        }
      } catch (err) {
        console.error("[Cron] Exam end sweep error:", err.message);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata",
    }
  );

  console.log("[Cron] Jobs registered: competition cleanup @ 00:00 IST daily.");
  console.log("[Cron] Jobs registered: daily quote rotation @ 00:00 IST daily.");
  console.log("[Cron] Jobs registered: live session end sweep every minute.");
}
