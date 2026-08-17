import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const CONNECT_TIMEOUT_MS = Number(process.env.SOCKET_REDIS_CONNECT_TIMEOUT_MS) || 3000;

function redisPassword() {
  const password = String(process.env.REDIS_PASSWORD || "").trim();
  return password || undefined;
}

function buildClientOptions() {
  const password = redisPassword();
  const options = {
    socket: {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: false,
    },
  };

  // Only send AUTH when Redis is actually configured with a password.
  // Passing password/REDIS_URL credentials against a no-auth Redis causes:
  // "ERR AUTH called without any password configured"
  if (password) {
    options.password = password;
  }

  return options;
}

function connectWithTimeout(client, label) {
  return Promise.race([
    client.connect(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS
      )
    ),
  ]);
}

export const createSocketRedisAdapter = async () => {
  const options = buildClientOptions();
  const pubClient = createClient(options);
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => {
    console.error("[socket.io][redis] pubClient error:", err?.message || err);
  });
  subClient.on("error", (err) => {
    console.error("[socket.io][redis] subClient error:", err?.message || err);
  });

  await connectWithTimeout(pubClient, "pubClient");
  await connectWithTimeout(subClient, "subClient");

  return {
    adapter: createAdapter(pubClient, subClient),
    pubClient,
    subClient,
  };
};

export const shouldEnableSocketRedisAdapter = () => {
  const flag = String(process.env.SOCKET_IO_REDIS_ADAPTER || "").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  // PM2 cluster: NODE_APP_INSTANCE is set on every worker — enable adapter by default.
  return process.env.NODE_APP_INSTANCE !== undefined;
};
