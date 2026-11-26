import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { router as authRouter } from "./auth.js";
import { router as certificateRouter } from "./certificates.js";
import { chainStatus } from "./chain.js";

const app = express();

app.use(cors({ origin: config.corsOrigins.includes("*") ? true : config.corsOrigins, exposedHeaders: ["Content-Disposition"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await chainStatus()) });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/certificates", certificateRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler - always answers JSON with a readable message.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || "Internal server error";
  if (err.code === "LIMIT_FILE_SIZE") {
    status = 413;
    message = "PDF is too large (max 5 MB).";
  } else if (err.code === "ECONNREFUSED" || err.code === "NETWORK_ERROR") {
    status = 503;
    message = "Cannot reach the blockchain node. Is `npx hardhat node` running?";
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`CertChain API listening on http://localhost:${config.port}`);
  console.log(`RPC: ${config.rpcUrl}`);
});
