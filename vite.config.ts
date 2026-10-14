import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true
      }
    }
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
