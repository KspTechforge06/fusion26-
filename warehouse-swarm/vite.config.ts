import { resolve } from "path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 5173, open: false },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});