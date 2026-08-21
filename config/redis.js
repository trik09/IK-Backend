import Redis from "ioredis";

if (!process.env.REDIS_PASSWORD && process.env.NODE_ENV === "production") {
  throw new Error("[Redis] REDIS_PASSWORD is required in production");
}

const redisPassword = process.env.REDIS_PASSWORD || undefined;

if (!redisPassword) {
  console.warn(
    "[Redis] REDIS_PASSWORD is not set; connecting without a password (non-production only)."
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