module.exports = {
  apps: [
    {
      name: "qcfy-backend",
      cwd: __dirname,
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
