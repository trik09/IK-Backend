const MAX_IN_FLIGHT = Number(process.env.LIVE_MAX_IN_FLIGHT) || 100;
const GET_TIMEOUT_MS = Number(process.env.LIVE_GET_TIMEOUT_MS) || 10000;

let inFlight = 0;

export function getLiveInFlight() {
  return inFlight;
}

/** Shed load before Mongo/Redis work piles up on a single Node process. */
export const liveConcurrencyGuard = (req, res, next) => {
  if (inFlight >= MAX_IN_FLIGHT) {
    res.setHeader("Retry-After", "1");
    return res.status(503).json({
      success: false,
      message: "Server busy. Retry shortly.",
    });
  }

  inFlight += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  res.on("finish", release);
  res.on("close", release);
  next();
};

export const liveGetTimeout = (ms = GET_TIMEOUT_MS) => (req, res, next) => {
  if (req.method === "GET") {
    req.setTimeout(ms);
    res.setTimeout(ms);
  }
  next();
};
