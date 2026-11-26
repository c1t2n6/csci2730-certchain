import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const DEPLOYMENT_FILE = path.join(ROOT_DIR, "deployment.json");

export const config = {
  port: Number(process.env.PORT || 4000),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  jwtSecret: process.env.JWT_SECRET || "certchain-dev-secret-change-me",
  // The API uses bearer tokens (no cookies), so allowing any origin is safe for
  // development; restrict it in production with e.g. CORS_ORIGIN=https://certs.example.edu
  corsOrigins: (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxPdfBytes: 5 * 1024 * 1024,
  studentTokenTtl: "8h",
  walletTokenTtl: "4h",
  nonceTtlMs: 5 * 60 * 1000,
};

if (!process.env.JWT_SECRET) {
  console.warn("[config] JWT_SECRET not set - using an insecure development default.");
}
