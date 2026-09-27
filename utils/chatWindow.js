const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** 12:00 AM IST on the calendar day after the event/competition start. */
export function getChatCloseAtMs(startTime) {
  if (startTime == null || startTime === "") return null;
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return null;

  const ist = new Date(startMs + IST_OFFSET_MS);
  const nextMidnightUtc = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );

  return nextMidnightUtc - IST_OFFSET_MS;
}

export function isChatOpenForEventDay(startTime, now = Date.now()) {
  const closeAt = getChatCloseAtMs(startTime);
  if (closeAt == null) return true;
  return now < closeAt;
}
