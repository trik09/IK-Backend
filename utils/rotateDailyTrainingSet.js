import PuzzleModel from "../models/PuzzleSchema.js";
import PlatformSettings from "../models/PlatformSettingsSchema.js";
import {
  selectPracticeDailyPuzzles,
  isIllegalPuzzle,
  isCaptureFoodPuzzle,
} from "./selectPracticeDailyPuzzles.js";

const SETTINGS_KEY = "global";
const TARGET_COUNT = 10;

export function istDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function getOrCreateSettings() {
  let doc = await PlatformSettings.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await PlatformSettings.create({
      key: SETTINGS_KEY,
      showReportIssueButton: true,
      autoRotateDailyTraining: true,
    });
  }
  return doc;
}

/**
 * Replace the daily training set with 10 practice puzzles.
 * @param {{ force?: boolean, respectAutoRotateFlag?: boolean }} options
 */
export async function rotateDailyTrainingSet(options = {}) {
  const { force = false, respectAutoRotateFlag = false } = options;
  const settings = await getOrCreateSettings();

  if (respectAutoRotateFlag && settings.autoRotateDailyTraining === false) {
    return {
      skipped: true,
      reason: "auto_rotate_disabled",
      message: "Auto-rotate daily training is turned off in admin settings.",
    };
  }

  const todayIst = istDateKey();
  if (!force && settings.lastDailyTrainingRotationDate === todayIst) {
    return {
      skipped: true,
      reason: "already_rotated_today",
      message: `Daily training set already rotated for ${todayIst} IST.`,
    };
  }

  const currentDaily = await PuzzleModel.find({ isDailyTraining: true })
    .select("_id")
    .lean();
  const currentIds = currentDaily.map((puzzle) => String(puzzle._id));

  const pool = await PuzzleModel.find({ level: { $in: [1, 2, 3] } }).lean();
  let selected = selectPracticeDailyPuzzles(pool, {
    targetCount: TARGET_COUNT,
    excludeIds: currentIds,
  });

  if (selected.length === 0) {
    throw new Error("No level 1–3 puzzles available to build a daily training set.");
  }

  const selectedIds = selected.map((puzzle) => puzzle._id);

  await PuzzleModel.updateMany(
    { isDailyTraining: true, _id: { $nin: selectedIds } },
    { $set: { isDailyTraining: false } },
  );
  await PuzzleModel.updateMany(
    { _id: { $in: selectedIds } },
    { $set: { isDailyTraining: true } },
  );

  settings.lastDailyTrainingRotationDate = todayIst;
  settings.lastDailyTrainingRotationAt = new Date();
  await settings.save();

  const illegalCount = selected.filter(isIllegalPuzzle).length;
  const captureCount = selected.filter(isCaptureFoodPuzzle).length;

  return {
    skipped: false,
    count: selected.length,
    illegalCount,
    captureCount,
    rotatedOn: todayIst,
    puzzleIds: selectedIds.map((id) => String(id)),
    message: `Daily set updated: ${selected.length} puzzles (${illegalCount} illegal, ${captureCount} capture).`,
  };
}
