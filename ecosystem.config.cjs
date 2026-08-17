const instances = process.env.PM2_INSTANCES || "1";
const useCluster = String(instances) !== "1";

module.exports = {
  apps: [
    {
      name: "qcfy-backend",
      cwd: __dirname,
      script: "index.js",
      instances: useCluster ? instances : 1,
      exec_mode: useCluster ? "cluster" : "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env: {
        NODE_ENV: "production",
        SOCKET_IO_REDIS_ADAPTER: useCluster ? "true" : "false",
      },
    },
  ],
};
