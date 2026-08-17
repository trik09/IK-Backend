import Redis from "ioredis";

const redisPassword =
  process.env.REDIS_PASSWORD !== undefined
    ? process.env.REDIS_PASSWORD || undefined
    : "QuickChess4You";

if (process.env.REDIS_PASSWORD === undefined) {
  console.warn(
    "[Redis] REDIS_PASSWORD is not set; using the legacy default. Set REDIS_PASSWORD in the environment."
  );
}

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  ...(redisPassword ? { password: redisPassword } : {}),
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  reconnectOnError: (err) => {
    const message = String(err?.message || "");
    return message.includes("READONLY");
  },
});

redis.on("connect", () => {
  console.log("[Redis] Connected");
});

redis.on("ready", () => {
  console.log("[Redis] Ready");
});

redis.on("error", (err) => {
  console.error("[Redis] Error:", err.message);
});

redis.on("reconnecting", () => {
  console.log("[Redis] Reconnecting...");
});

export default redis;