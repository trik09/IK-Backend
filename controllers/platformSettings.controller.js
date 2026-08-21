import PlatformSettings from "../models/PlatformSettingsSchema.js";
import { getIO } from "../utils/socketHandlers.js";

const SETTINGS_KEY = "global";
let settingsCache = null;

const toPublic = (doc) => ({
  showReportIssueButton: Boolean(doc?.showReportIssueButton),
});

const loadSettings = async () => {
  if (settingsCache) return settingsCache;

  let doc = await PlatformSettings.findOne({ key: SETTINGS_KEY }).lean();
  if (!doc) {
    doc = await PlatformSettings.create({
      key: SETTINGS_KEY,
      showReportIssueButton: true,
    });
    doc = doc.toObject ? doc.toObject() : doc;
  }

  settingsCache = toPublic(doc);
  return settingsCache;
};

export const getPlatformSettings = async (_req, res) => {
  try {
    const settings = await loadSettings();
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("getPlatformSettings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load platform settings",
    });
  }
};

export const updatePlatformSettings = async (req, res) => {
  try {
    const showReportIssueButton = Boolean(req.body?.showReportIssueButton);

    const doc = await PlatformSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: { showReportIssueButton } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    settingsCache = toPublic(doc);

    try {
      const io = getIO();
      io?.emit("platformSettingsUpdated", settingsCache);
    } catch (emitErr) {
      console.error("platformSettings emit failed:", emitErr);
    }

    return res.json({
      success: true,
      settings: settingsCache,
      message: showReportIssueButton
        ? "Report Issue button is now visible to users"
        : "Report Issue button is now hidden from users",
    });
  } catch (error) {
    console.error("updatePlatformSettings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update platform settings",
    });
  }
};
