/**
 * Wall-clock exam participation time.
 *
 * Time spent = from when the user started the exam (entered the take view)
 * until submission (manual or auto). Falls back to max(joinedAt, exam.startTime)
 * when startedAt has not been recorded yet.
 */

const toMs = (value) => {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

/**
 * Official exam end = earlier of stored endTime and startTime + duration.
 * Same rule the REST exam controller uses for LIVE vs ENDED.
 */
export const getOfficialExamEnd = (exam = {}) => {
  const start = toMs(exam.startTime);
  const storedEnd = toMs(exam.endTime);
  const durationMs = Number(exam.duration) * 60 * 1000;
  const fromDuration =
    Number.isFinite(start) && Number.isFinite(durationMs) && durationMs > 0
      ? start + durationMs
      : NaN;

  if (Number.isFinite(fromDuration) && Number.isFinite(storedEnd)) {
    return new Date(Math.min(storedEnd, fromDuration));
  }
  if (Number.isFinite(fromDuration)) return new Date(fromDuration);
  if (Number.isFinite(storedEnd)) return new Date(storedEnd);
  return null;
};

const sumAnswerQuestionTime = (participant = {}) =>
  (participant.answers || []).reduce(
    (sum, a) => sum + (Number(a.questionTimeSpent) || 0),
    0,
  );

export const getParticipationStartMs = (participant = {}, exam = {}) => {
  const startedAt = toMs(participant.startedAt);
  if (Number.isFinite(startedAt)) return startedAt;

  const joinedAt = toMs(participant.joinedAt);
  const examStart = toMs(exam.startTime);

  if (Number.isFinite(joinedAt) && Number.isFinite(examStart)) {
    return Math.max(joinedAt, examStart);
  }
  if (Number.isFinite(joinedAt)) return joinedAt;
  if (Number.isFinite(examStart)) return examStart;
  return NaN;
};

export const computeWallClockTimeSpent = (
  participant = {},
  exam = {},
  submittedAt = new Date(),
) => {
  const startMs = getParticipationStartMs(participant, exam);
  const endMs = toMs(submittedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.floor((endMs - startMs) / 1000);
};

/**
 * Prefer stored wall-clock time; if missing/zero (e.g. force-submit used a
 * shortened endTime that landed before startedAt), recompute from session
 * bounds and fall back to per-question active time.
 */
export const resolveParticipantTimeSpent = (
  participant = {},
  exam = {},
) => {
  const stored = Number(participant.timeSpent);
  if (Number.isFinite(stored) && stored > 0) return stored;

  if (participant.submittedAt) {
    const fromSubmit = computeWallClockTimeSpent(
      participant,
      exam,
      participant.submittedAt,
    );
    if (fromSubmit > 0) return fromSubmit;

    // Admin shortened endTime so submittedAt can be before startedAt.
    // Prefer any end bound that is still after session start; then answer
    // times; then exam.updatedAt (when duration was changed / force-submitted).
    const startMs = getParticipationStartMs(participant, exam);
    const submittedMs = toMs(participant.submittedAt);
    const endMs = toMs(exam.endTime);
    const updatedMs = toMs(exam.updatedAt);
    if (Number.isFinite(startMs)) {
      const candidates = [submittedMs, endMs, updatedMs].filter(
        (ms) => Number.isFinite(ms) && ms >= startMs,
      );
      if (candidates.length) {
        return Math.floor((Math.max(...candidates) - startMs) / 1000);
      }
    }

    const fromAnswers = sumAnswerQuestionTime(participant);
    if (fromAnswers > 0) return fromAnswers;
  }

  return Number.isFinite(stored) ? Math.max(0, stored) : 0;
};

/**
 * Best timeSpent to persist on submit / force-submit.
 * Never overwrite a positive accumulated value with 0.
 */
export const resolveTimeSpentForSubmit = (
  participant = {},
  exam = {},
  submittedAt = new Date(),
) => {
  const wallClock = computeWallClockTimeSpent(participant, exam, submittedAt);
  const prior = Number(participant.timeSpent) || 0;
  const fromAnswers = sumAnswerQuestionTime(participant);
  return Math.max(wallClock, prior, fromAnswers);
};
