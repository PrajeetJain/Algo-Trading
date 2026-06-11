// PM2 process file for VPS deployment: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "aindra-api",
      script: "server/index.js",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        API_PORT: "8787",
        // Keep 127.0.0.1 and front it with a reverse proxy (Caddy/Nginx)
        // that adds HTTPS + basic auth. Do not expose the API raw.
        API_HOST: "127.0.0.1",
      },
      out_file: "logs/aindra-out.log",
      error_file: "logs/aindra-err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
