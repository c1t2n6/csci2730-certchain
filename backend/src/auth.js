/**
 * Authentication
 *  - Students: student ID + password (bcrypt) -> JWT
 *  - Institutions / admin: "Sign-In with Ethereum" style challenge.
 *    The wallet signs a one-time nonce (ECDSA, personal_sign); the server recovers
 *    the signer address and checks its role directly on the smart contract.
 *    No password or private key ever reaches the server.
 */
import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { config } from "./config.js";
import { createStudent, findStudent, normaliseStudentId } from "./store.js";
import { getDeployment, getWalletRole } from "./chain.js";

export const router = Router();

const httpError = (status, message) => Object.assign(new Error(message), { status });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID_RE = /^[A-Za-z0-9-]{4,20}$/;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function readToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), config.jwtSecret);
  } catch {
    return null;
  }
}

/** Attaches req.user if a valid token is present (never rejects). */
export function optionalAuth(req, _res, next) {
  req.user = readToken(req);
  next();
}

/** Requires one of the given roles: "student", "issuer", "admin". */
export const requireRole = (...roles) => (req, _res, next) => {
  const user = readToken(req);
  if (!user) return next(httpError(401, "Please sign in first."));
  if (!roles.includes(user.role)) return next(httpError(403, "You do not have access to this resource."));
  req.user = user;
  next();
};

// ---------------------------------------------------------------------------
// Student accounts
// ---------------------------------------------------------------------------

const studentToken = (s) =>
  jwt.sign({ role: "student", studentId: s.studentId, email: s.email, name: s.fullName }, config.jwtSecret, {
    expiresIn: config.studentTokenTtl,
  });

const publicStudent = (s) => ({ studentId: s.studentId, fullName: s.fullName, email: s.email });

router.post("/register", async (req, res, next) => {
  try {
    const { studentId, fullName, email, password } = req.body || {};
    if (!STUDENT_ID_RE.test(studentId || "")) throw httpError(400, "Student ID must be 4-20 letters, digits or dashes.");
    if (!fullName || fullName.trim().length < 2) throw httpError(400, "Please enter your full name.");
    if (!EMAIL_RE.test(email || "")) throw httpError(400, "Please enter a valid e-mail address.");
    if (!password || password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    if (findStudent(studentId)) throw httpError(409, "An account with this student ID already exists.");

    const student = createStudent({
      studentId: normaliseStudentId(studentId),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ token: studentToken(student), student: publicStudent(student) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { studentId, password } = req.body || {};
    const student = findStudent(studentId);
    const ok = student && (await bcrypt.compare(password || "", student.passwordHash));
    if (!ok) throw httpError(401, "Incorrect student ID or password.");
    res.json({ token: studentToken(student), student: publicStudent(student) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireRole("student", "issuer", "admin"), (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// Wallet sign-in for institutions
// ---------------------------------------------------------------------------

const nonces = new Map(); // address(lowercase) -> { message, expires }

router.get("/wallet/challenge", (req, res, next) => {
  try {
    const address = String(req.query.address || "");
    if (!ethers.isAddress(address)) throw httpError(400, "Invalid wallet address.");
    const deployment = getDeployment();
    const nonce = crypto.randomBytes(16).toString("hex");
    const message = [
      "CertChain institution sign-in",
      "",
      "Sign this message to prove you control this wallet.",
      "It does not send a transaction or cost any gas.",
      "",
      `Wallet: ${ethers.getAddress(address)}`,
      `Contract: ${deployment.address}`,
      `Chain ID: ${deployment.chainId}`,
      `Nonce: ${nonce}`,
      `Issued at: ${new Date().toISOString()}`,
    ].join("\n");
    nonces.set(address.toLowerCase(), { message, expires: Date.now() + config.nonceTtlMs });
    res.json({ message });
  } catch (err) {
    next(err);
  }
});

router.post("/wallet/verify", async (req, res, next) => {
  try {
    const { address, signature } = req.body || {};
    if (!ethers.isAddress(address || "")) throw httpError(400, "Invalid wallet address.");
    const entry = nonces.get(address.toLowerCase());
    nonces.delete(address.toLowerCase()); // one-time use
    if (!entry || entry.expires < Date.now()) throw httpError(401, "Sign-in challenge expired, please try again.");

    let recovered;
    try {
      recovered = ethers.verifyMessage(entry.message, signature);
    } catch {
      throw httpError(401, "Malformed signature.");
    }
    if (recovered.toLowerCase() !== address.toLowerCase()) throw httpError(401, "Signature does not match wallet.");

    const role = await getWalletRole(recovered);
    if (!role) throw httpError(403, "This wallet is not a registered institution on the contract.");

    const token = jwt.sign({ role, address: recovered }, config.jwtSecret, { expiresIn: config.walletTokenTtl });
    res.json({ token, role, address: recovered });
  } catch (err) {
    next(err);
  }
});
