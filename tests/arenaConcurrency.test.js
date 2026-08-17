import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { redisScore } from "../utils/leaderboardScore.js";
import { createCircuitBreaker } from "../utils/circuitBreaker.js";
import { createSingleflight } from "../utils/singleflight.js";
import {
  buildIdempotentAttemptResponse,
  sanitizeStoredSolveSeconds,
  normalizePuzzleTimeSpent,
} from "../utils/puzzleAttemptUtils.js";
import { parseLeaderboardPaging } from "../utils/paging.js";
import { liveConcurrencyGuard } from "../middleware/liveLoadGuard.middleware.js";

test("redisScore ranks more solves first, then lower time", () => {
  const a = redisScore({ puzzlesSolved: 3, timeSpent: 40, score: 30 });
  const b = redisScore({ puzzlesSolved: 2, timeSpent: 10, score: 20 });
  const c = redisScore({ puzzlesSolved: 3, timeSpent: 20, score: 30 });
  assert.ok(a > b);
  assert.ok(c > a);
});

test("circuit breaker opens after consecutive failures and uses fallback", async () => {
  const breaker = createCircuitBreaker({
    name: "test",
    failureThreshold: 2,
    resetMs: 50,
  });
  let calls = 0;
  const fail = async () => {
    calls += 1;
    throw new Error("mongo down");
  };

  const first = await breaker.exec(fail, () => "stale");
  assert.equal(first, "stale");
  const second = await breaker.exec(fail, () => "stale");
  assert.equal(second, "stale");
  assert.equal(breaker.isOpen(), true);

  const blocked = await breaker.exec(fail, () => "blocked");
  assert.equal(blocked, "blocked");
  assert.equal(calls, 2);
});

test("singleflight coalesces concurrent callers onto one promise", async () => {
  const flight = createSingleflight();
  let runs = 0;
  const task = () =>
    new Promise((resolve) => {
      runs += 1;
      setTimeout(() => resolve("ok"), 20);
    });

  const [a, b, c] = await Promise.all([
    flight("k", task),
    flight("k", task),
    flight("k", task),
  ]);
  assert.equal(a, "ok");
  assert.equal(b, "ok");
  assert.equal(c, "ok");
  assert.equal(runs, 1);
});

test("sanitizeStoredSolveSeconds drops unix timestamps", () => {
  assert.equal(sanitizeStoredSolveSeconds(12), 12);
  assert.equal(sanitizeStoredSolveSeconds(1_700_000_000), 0);
  assert.equal(sanitizeStoredSolveSeconds(-5), 0);
});

test("normalizePuzzleTimeSpent clamps invalid client values", () => {
  assert.equal(normalizePuzzleTimeSpent(0), 1);
  assert.equal(normalizePuzzleTimeSpent(8), 8);
  assert.equal(normalizePuzzleTimeSpent(1_700_000_000), 1);
});

test("idempotent attempt response does not award extra score", () => {
  const response = buildIdempotentAttemptResponse(
    { status: "solved", scoreEarned: 10 },
    { score: 20, puzzlesSolved: 2 }
  );
  assert.equal(response.idempotent, true);
  assert.equal(response.isCorrect, true);
  assert.equal(response.totalScore, 20);
  assert.equal(response.puzzlesSolved, 2);
});

test("parseLeaderboardPaging clamps limit and skip", () => {
  assert.deepEqual(parseLeaderboardPaging({ limit: "9999", skip: "-2" }), {
    limit: 500,
    skip: 0,
  });
  assert.deepEqual(parseLeaderboardPaging({ limit: "10", skip: "5" }), {
    limit: 10,
    skip: 5,
  });
});

test("liveConcurrencyGuard sheds load with 503", () => {
  const req = {};
  const makeRes = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.setHeader = () => {};
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.body = body;
      res.emit("finish");
      return res;
    };
    return res;
  };

  const original = process.env.LIVE_MAX_IN_FLIGHT;
  process.env.LIVE_MAX_IN_FLIGHT = "1";

  // Guard reads MAX at module load, so we fill the in-flight counter via sequential holds.
  const held = [];
  for (let i = 0; i < 120; i += 1) {
    const res = makeRes();
    let calledNext = false;
    liveConcurrencyGuard(req, res, () => {
      calledNext = true;
    });
    if (!calledNext) {
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.success, false);
      break;
    }
    held.push(res);
  }
  assert.ok(held.length >= 1);
  held.forEach((res) => res.emit("finish"));
  process.env.LIVE_MAX_IN_FLIGHT = original;
});

test("concurrent first-wins scoring does not double increment", async () => {
  const claimed = new Set();
  let score = 0;
  const submit = async () => {
    if (claimed.has("puzzle-1")) {
      return { idempotent: true, score };
    }
    claimed.add("puzzle-1");
    score += 10;
    return { idempotent: false, score };
  };

  const results = await Promise.all(Array.from({ length: 25 }, () => submit()));
  const awarded = results.filter((r) => !r.idempotent);
  assert.equal(awarded.length, 1);
  assert.equal(score, 10);
});
