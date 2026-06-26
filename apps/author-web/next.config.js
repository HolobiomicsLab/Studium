/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    INGEST_SERVICE_URL: process.env.INGEST_SERVICE_URL || "http://localhost:8000",
    PLANNER_SERVICE_URL: process.env.PLANNER_SERVICE_URL || "http://localhost:8001",
    // Learner-as-author (/studio) talks to scene-synth. The client reads the
    // NEXT_PUBLIC_ form (lib/api.ts); default :8002 matches the backend.
    NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL:
      process.env.NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL || "http://localhost:8002",
  },
};

module.exports = nextConfig;
