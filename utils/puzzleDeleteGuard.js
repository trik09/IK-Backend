import mongoose from "mongoose";
import CompetitionModel from "../models/CompetitionSchema.js";
import EventModel from "../models/EventSchema.js";
import EventRoundModel from "../models/EventRoundSchema.js";
import { getPuzzleIdsFromCompetition } from "./puzzleUsageCount.js";

export function resolveEffectiveStatus(doc, now = new Date()) {
  if (!doc) return "ENDED";

  const start = doc.startTime ? new Date(doc.startTime) : null;
  const end = doc.endTime ? new Date(doc.endTime) : null;

  if (end && now > end) return "ENDED";
  if (start && end && now >= start && now <= end) return "LIVE";
  if (start && now < start) return "UPCOMING";
  return doc.status || "UPCOMING";
}

function getMatchingPuzzleIds(doc, puzzleIdSet) {
  const allIds = getPuzzleIdsFromCompetition(doc);
  return allIds.filter((id) => puzzleIdSet.has(String(id)));
}

function formatWhen(startTime, endTime) {
  if (!startTime) return "";
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const startLabel = start.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (!end) return `starts ${startLabel} IST`;
  const endLabel = end.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${startLabel} – ${endLabel} IST`;
}

function formatUsageLine(usage) {
  const status = usage.status.toLowerCase();
  const when = formatWhen(usage.startTime, usage.endTime);

  if (usage.type === "event-round" && usage.eventName) {
    const round = usage.roundName ? ` — round "${usage.roundName}"` : "";
    return `Event "${usage.eventName}"${round} (${status}${when ? `, ${when}` : ""})`;
  }

  if (usage.type === "event" && usage.eventName) {
    return `Event "${usage.eventName}" (${status}${when ? `, ${when}` : ""})`;
  }

  return `Competition "${usage.competitionName}" (${status}${when ? `, ${when}` : ""})`;
}

export function formatCategoryBlockedDeleteMessage(categoryName, usages) {
  const blockedCount = new Set(usages.flatMap((usage) => usage.puzzleIds)).size;
  const lines = usages.map((usage) => `• ${formatUsageLine(usage)}`);
  return `Cannot delete category "${categoryName}": ${blockedCount} puzzle(s) are part of the following active or upcoming event(s)/competition(s):\n${lines.join("\n")}\nRemove them from those events/competitions first.`;
}

export function formatBlockedDeleteMessage(usages, { puzzleCount = 1 } = {}) {
  const lines = usages.map((usage) => `• ${formatUsageLine(usage)}`);
  const header =
    puzzleCount === 1
      ? "Cannot delete: this puzzle is part of the following active or upcoming event(s)/competition(s):"
      : `Cannot delete ${puzzleCount} puzzle(s). They are used in the following active or upcoming event(s)/competition(s):`;

  return `${header}\n${lines.join("\n")}\nRemove them from those events/competitions first.`;
}

export async function findActivePuzzleUsages(puzzleIds = [], now = new Date()) {
  const puzzleIdSet = new Set(puzzleIds.map(String).filter(Boolean));
  if (!puzzleIdSet.size) return [];

  const ids = [...puzzleIdSet];
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

  const [competitions, events] = await Promise.all([
    CompetitionModel.find(
      {
        $or: [
          { puzzles: { $in: objectIds } },
          { "chapters.puzzleIds": { $in: ids } },
        ],
      },
      { name: 1, status: 1, startTime: 1, endTime: 1, puzzles: 1, chapters: 1 }
    ).lean(),
    EventModel.find(
      { puzzles: { $in: objectIds } },
      { name: 1, status: 1, startTime: 1, endTime: 1, puzzles: 1 }
    ).lean(),
  ]);

  const activeCompetitions = competitions.filter(
    (comp) => resolveEffectiveStatus(comp, now) !== "ENDED"
  );

  const compIds = activeCompetitions.map((comp) => comp._id);
  const rounds = compIds.length
    ? await EventRoundModel.find({ competitionId: { $in: compIds } })
        .populate("eventId", "name status startTime endTime")
        .lean()
    : [];

  const roundByCompId = new Map(
    rounds.map((round) => [String(round.competitionId), round])
  );

  const usages = [];

  for (const comp of activeCompetitions) {
    const matchedPuzzleIds = getMatchingPuzzleIds(comp, puzzleIdSet);
    if (!matchedPuzzleIds.length) continue;

    const round = roundByCompId.get(String(comp._id));
    const eventDoc = round?.eventId;
    const status = resolveEffectiveStatus(comp, now);

    if (eventDoc && resolveEffectiveStatus(eventDoc, now) !== "ENDED") {
      usages.push({
        type: "event-round",
        puzzleIds: matchedPuzzleIds,
        competitionId: comp._id,
        competitionName: comp.name,
        eventId: eventDoc._id,
        eventName: eventDoc.name,
        roundName: round?.name || comp.name,
        status,
        startTime: comp.startTime,
        endTime: comp.endTime,
      });
      continue;
    }

    usages.push({
      type: "competition",
      puzzleIds: matchedPuzzleIds,
      competitionId: comp._id,
      competitionName: comp.name,
      status,
      startTime: comp.startTime,
      endTime: comp.endTime,
    });
  }

  for (const event of events) {
    const matchedPuzzleIds = (event.puzzles || [])
      .map(String)
      .filter((id) => puzzleIdSet.has(id));
    if (!matchedPuzzleIds.length) continue;
    if (resolveEffectiveStatus(event, now) === "ENDED") continue;

    usages.push({
      type: "event",
      puzzleIds: matchedPuzzleIds,
      eventId: event._id,
      eventName: event.name,
      status: resolveEffectiveStatus(event, now),
      startTime: event.startTime,
      endTime: event.endTime,
    });
  }

  return usages;
}

export async function assertPuzzlesNotInActiveEvents(puzzleIds = [], now = new Date()) {
  const usages = await findActivePuzzleUsages(puzzleIds, now);
  if (!usages.length) return null;

  const blockedPuzzleIds = [...new Set(usages.flatMap((usage) => usage.puzzleIds))];
  const message = formatBlockedDeleteMessage(usages, {
    puzzleCount: blockedPuzzleIds.length,
  });

  return {
    message,
    usages,
    blockedPuzzleIds,
  };
}
