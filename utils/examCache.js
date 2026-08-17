/**
 * Redis + in-process helpers for concurrent exam traffic.
 * - exam:meta     short TTL, join / details
 * - exam:end      endTime only, save-answer hot path
 * - exam:quizzes  full quiz docs for scoring
 * - exam:paper    sanitized student paper (no roster)
 * - exam:roster   lean lobby list
 * - exam:lb       short-TTL leaderboard payload
 */

import mongoose from "mongoose";
import redis from "../config/redis.js";
import { safeRedisGet, safeRedisSetex, safeRedisDel } from "./redisWrapper.js";
import { recordHit, recordMiss } from "./cacheMetrics.js";
import ExamModel from "../models/ExamSchema.js";
import ExamParticipantModel from "../models/ExamParticipantSchema.js";
import QuizModel from "../models/QuizSchema.js";
import { getQuizIdsFromExam } from "./quizUsageCount.js";
import { sanitizeQuizForUser } from "./examQuizSanitize.js";

const metaKey = (examId) => `exam:meta:${examId}`;
const endKey = (examId) => `exam:end:${examId}`;
const quizKey = (examId) => `exam:quizzes:${examId}`;
const paperKey = (examId) => `exam:paper:${examId}`;
const rosterKey = (examId) => `exam:roster:${examId}`;
const lbKey = (examId) => `exam:lb:${examId}`;

const META_TTL_SEC = 30;
const END_TTL_SEC = 60;
const ROSTER_TTL_SEC = 5;
const LB_TTL_SEC = 5;

const memEnd = new Map();
const memQuizDocs = new Map();
const memPaper = new Map();

const quizIdString = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const liveTtlSec = (exam) =>
  Math.max(
    60,
    Math.min(
      3600,
      Math.floor((new Date(exam.endTime).getTime() - Date.now()) / 1000) + 600 || 600
    )
  );

const clearMem = (examId) => {
  const id = String(examId);
  memEnd.delete(id);
  memQuizDocs.delete(id);
  memPaper.delete(id);
};

export async function invalidateExamCache(examId) {
  if (!examId) return;
  const id = String(examId);
  clearMem(id);
  await safeRedisDel(
    metaKey(id),
    endKey(id),
    quizKey(id),
    paperKey(id),
    rosterKey(id),
    lbKey(id)
  );
}

export async function invalidateExamRoster(examId) {
  if (!examId) return;
  const id = String(examId);
  await safeRedisDel(rosterKey(id), lbKey(id));
}

export async function getExamMeta(examId) {
  const id = String(examId);
  const cached = await safeRedisGet(metaKey(id));
  if (cached) {
    recordHit("examMeta");
    return cached;
  }
  recordMiss("examMeta");

  const exam = await ExamModel.findById(id)
    .select(
      "name description startTime endTime duration chapters isActive maxParticipants accessCode resultsPublished status createdBy"
    )
    .lean();

  if (!exam) return null;

  await safeRedisSetex(metaKey(id), META_TTL_SEC, exam);
  return exam;
}

export async function getExamEndTime(examId) {
  const id = String(examId);
  const mem = memEnd.get(id);
  if (mem && mem.expiresAt > Date.now()) {
    recordHit("examMeta");
    return mem.endTime;
  }

  const cached = await safeRedisGet(endKey(id));
  if (cached) {
    const endTime = typeof cached === "string" ? cached : String(cached);
    memEnd.set(id, { endTime, expiresAt: Date.now() + END_TTL_SEC * 1000 });
    return endTime;
  }

  const exam = await getExamMeta(id);
  if (!exam?.endTime) return null;

  const endTime =
    typeof exam.endTime === "string"
      ? exam.endTime
      : new Date(exam.endTime).toISOString();

  memEnd.set(id, { endTime, expiresAt: Date.now() + END_TTL_SEC * 1000 });
  await safeRedisSetex(endKey(id), END_TTL_SEC, endTime);
  return endTime;
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

  const mem = memQuizDocs.get(examId);
  if (mem && mem.expiresAt > Date.now() && mem.docs.length === quizIds.length) {
    return mem.docs;
  }

  let docs = null;
  try {
    const cached = await redis.get(quizKey(examId));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length === quizIds.length) {
        docs = parsed;
      }
    }
  } catch {
    // fall through
  }

  if (!docs) {
    docs = await QuizModel.find({ _id: { $in: quizIds } })
      .select("-__v")
      .lean();
    const ttl = liveTtlSec(exam);
    try {
      await redis.setex(quizKey(examId), ttl, JSON.stringify(docs));
    } catch {
      // cache is optional
    }
  }

  memQuizDocs.set(examId, {
    docs,
    expiresAt: Date.now() + liveTtlSec(exam) * 1000,
  });
  return docs;
}

export function attachSanitizedQuizzes(exam, quizDocs = []) {
  const byId = {};
  for (const quiz of docsOrEmpty(quizDocs)) {
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

function docsOrEmpty(quizDocs) {
  return quizDocs || [];
}

export async function getSanitizedExamPaper(exam) {
  if (!exam?._id) return exam;
  const examId = String(exam._id);

  const mem = memPaper.get(examId);
  if (mem && mem.expiresAt > Date.now()) return mem.payload;

  try {
    const cached = await redis.get(paperKey(examId));
    if (cached) {
      const payload = JSON.parse(cached);
      memPaper.set(examId, {
        payload,
        expiresAt: Date.now() + liveTtlSec(exam) * 1000,
      });
      return payload;
    }
  } catch {
    // fall through
  }

  const quizDocs = await getExamQuizDocs(exam);
  const { accessCode, createdBy, participants, ...rest } = exam;
  const payload = attachSanitizedQuizzes(rest, quizDocs);
  delete payload.accessCode;

  const ttl = liveTtlSec(exam);
  try {
    await redis.setex(paperKey(examId), ttl, JSON.stringify(payload));
  } catch {
    // optional
  }
  memPaper.set(examId, { payload, expiresAt: Date.now() + ttl * 1000 });
  return payload;
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
    correctCount: doc.correctCount ?? 0,
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
        ? "userId joinedAt startedAt submittedAt score timeSpent correctCount answers"
        : "userId joinedAt startedAt submittedAt score timeSpent correctCount"
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

export async function getCachedLeaderboardPayload(examId) {
  try {
    const raw = await redis.get(lbKey(String(examId)));
    if (raw) return JSON.parse(raw);
  } catch {
    // miss
  }
  return null;
}

export async function setCachedLeaderboardPayload(examId, payload) {
  try {
    await redis.setex(lbKey(String(examId)), LB_TTL_SEC, JSON.stringify(payload));
  } catch {
    // optional
  }
}

export async function getMyExamParticipant(examId, userId) {
  return ExamParticipantModel.findOne({ examId, userId })
    .populate("userId", "name username avatar profilePicture email")
    .lean();
}

export function toObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}
