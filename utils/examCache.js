/**
 * Redis helpers for concurrent exam traffic.
 * - exam:meta     short TTL, used by saveAnswer / join
 * - exam:quizzes  full quiz docs for scoring + sanitized paper
 * - exam:roster   lean participant list for lobby / take-exam
 */

import redis from "../config/redis.js";
import ExamModel from "../models/ExamSchema.js";
import ExamParticipantModel from "../models/ExamParticipantSchema.js";
import QuizModel from "../models/QuizSchema.js";
import { getQuizIdsFromExam } from "./quizUsageCount.js";
import { sanitizeQuizForUser } from "./examQuizSanitize.js";

const metaKey = (examId) => `exam:meta:${examId}`;
const quizKey = (examId) => `exam:quizzes:${examId}`;
const rosterKey = (examId) => `exam:roster:${examId}`;

const META_TTL_SEC = 30;
const ROSTER_TTL_SEC = 5;

const quizIdString = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

export async function invalidateExamCache(examId) {
  if (!examId) return;
  const id = String(examId);
  try {
    await redis.del(metaKey(id), quizKey(id), rosterKey(id));
  } catch (error) {
    console.error("[examCache] invalidate failed:", error?.message || error);
  }
}

export async function invalidateExamRoster(examId) {
  if (!examId) return;
  try {
    await redis.del(rosterKey(String(examId)));
  } catch (error) {
    console.error("[examCache] roster invalidate failed:", error?.message || error);
  }
}

export async function getExamMeta(examId) {
  const id = String(examId);
  try {
    const cached = await redis.get(metaKey(id));
    if (cached) return JSON.parse(cached);
  } catch {
    // fall through to Mongo
  }

  const exam = await ExamModel.findById(id)
    .select(
      "name description startTime endTime duration chapters isActive maxParticipants accessCode resultsPublished status createdBy"
    )
    .lean();

  if (!exam) return null;

  try {
    await redis.setex(metaKey(id), META_TTL_SEC, JSON.stringify(exam));
  } catch {
    // cache is optional
  }

  return exam;
}

export function quizDocsToMap(docs = []) {
  const map = new Map();
  for (const quiz of docs) {
    if (quiz?._id) map.set(String(quiz._id), quiz);
  }
  return map;
}

export async function getExamQuizDocs(exam) {
  if (!exam?._id) return [];
  const examId = String(exam._id);
  const quizIds = getQuizIdsFromExam(exam).map(quizIdString).filter(Boolean);

  if (quizIds.length === 0) return [];

  try {
    const cached = await redis.get(quizKey(examId));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length === quizIds.length) {
        return parsed;
      }
    }
  } catch {
    // fall through
  }

  const docs = await QuizModel.find({ _id: { $in: quizIds } })
    .select("-__v")
    .lean();

  const ttl = Math.max(
    60,
    Math.min(
      3600,
      Math.floor((new Date(exam.endTime).getTime() - Date.now()) / 1000) + 600 || 600
    )
  );

  try {
    await redis.setex(quizKey(examId), ttl, JSON.stringify(docs));
  } catch {
    // cache is optional
  }

  return docs;
}

export function attachSanitizedQuizzes(exam, quizDocs = []) {
  const byId = {};
  for (const quiz of quizDocs) {
    byId[String(quiz._id)] = sanitizeQuizForUser(quiz);
  }

  return {
    ...exam,
    chapters: (exam.chapters || []).map((chapter) => ({
      ...chapter,
      quizIds: (chapter.quizIds || []).map((id) => {
        const key = quizIdString(id);
        return byId[key] || key;
      }),
    })),
  };
}

export function toApiParticipant(doc, { viewerId, includeAnswers = false } = {}) {
  const user =
    doc.userId && typeof doc.userId === "object" && doc.userId._id
      ? doc.userId
      : { _id: doc.userId };
  const pId = String(user._id || doc.userId || "");
  const isMe = viewerId ? pId === String(viewerId) : false;

  const row = {
    user,
    joinedAt: doc.joinedAt ?? null,
    startedAt: doc.startedAt ?? null,
    submittedAt: doc.submittedAt ?? null,
    score: doc.submittedAt ? (doc.score ?? 0) : isMe ? (doc.score ?? 0) : 0,
    timeSpent: doc.timeSpent ?? 0,
    status: doc.submittedAt ? "Submitted" : "Joined",
  };

  if (includeAnswers && isMe) {
    row.answers = doc.answers ?? [];
  }

  return row;
}

export async function getExamRoster(examId, { viewerId, includeMyAnswers = false } = {}) {
  const id = String(examId);

  if (!includeMyAnswers) {
    try {
      const cached = await redis.get(rosterKey(id));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // fall through
    }
  }

  const docs = await ExamParticipantModel.find({ examId: id })
    .select(
      includeMyAnswers
        ? "userId joinedAt startedAt submittedAt score timeSpent answers"
        : "userId joinedAt startedAt submittedAt score timeSpent"
    )
    .populate("userId", "name username avatar profilePicture email")
    .lean();

  const roster = docs.map((doc) =>
    toApiParticipant(doc, { viewerId, includeAnswers: includeMyAnswers })
  );

  if (!includeMyAnswers) {
    try {
      await redis.setex(rosterKey(id), ROSTER_TTL_SEC, JSON.stringify(roster));
    } catch {
      // optional
    }
  }

  return roster;
}

export async function getMyExamParticipant(examId, userId) {
  return ExamParticipantModel.findOne({ examId, userId }).lean();
}
