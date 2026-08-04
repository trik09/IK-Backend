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

export const resolveParticipantTimeSpent = (
  participant = {},
  exam = {},
) => {
  if (participant.submittedAt) {
    const stored = Number(participant.timeSpent);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return computeWallClockTimeSpent(participant, exam, participant.submittedAt);
  }
  return Number(participant.timeSpent) || 0;
};
