/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    INGEST_SERVICE_URL: process.env.INGEST_SERVICE_URL || "http://localhost:8000",
    PLANNER_SERVICE_URL: process.env.PLANNER_SERVICE_URL || "http://localhost:8001",
  },
};

module.exports = nextConfig;
