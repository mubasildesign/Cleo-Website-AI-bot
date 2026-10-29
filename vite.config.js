import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { route } from "./api/lib/handlers.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function attach(server) {
  server.middlewares.use(async (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!pathname.startsWith("/api/") || pathname.startsWith("/api/lib/")) return next();
    try {
      await route(req, res);
    } catch (error) {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: error.message || "Server error" }));
      }
    }
  });
}

function axonApi() {
  return {
    name: "axon-api",
    configureServer: attach,
    configurePreviewServer: attach
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src")
    }
  },
  server: { cors: false },
  preview: { cors: false },
  plugins: [axonApi(), react()]
});
