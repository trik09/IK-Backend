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
  maxRetriesPerRequest: null
});

redis.on("connect", () => {
  console.log(" Redis connected");
});

redis.on("ready", () => {
  console.log(" Redis ready");
});

redis.on("error", (err) => {
  console.error(" Redis error:", err.message);
});

export default redis;