/**
 * Tiny JSON-file data store (no native dependencies, works on Windows/macOS/Linux).
 *
 * Layout of data/db.json:
 * {
 *   students:     { [studentIdNormalised]: { studentId, fullName, email, passwordHash, createdAt } },
 *   certificates: { [contractAddress]: { [certId]: CertificateRecord } }
 * }
 *
 * Certificate records are namespaced by contract address so re-deploying the
 * contract (e.g. restarting the local Hardhat node) never mixes stale data.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, FILES_DIR } from "./config.js";

const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(FILES_DIR, { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { students: {}, certificates: {} };
  }
}

let db = load();

function persist() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const normaliseStudentId = (id) => String(id || "").trim().toUpperCase();

// ---- Students -------------------------------------------------------------

export function findStudent(studentId) {
  return db.students[normaliseStudentId(studentId)] || null;
}

export function createStudent(student) {
  const key = normaliseStudentId(student.studentId);
  db.students[key] = { ...student, studentId: key };
  persist();
  return db.students[key];
}

// ---- Certificates ---------------------------------------------------------

const bucket = (contract) => {
  const k = contract.toLowerCase();
  if (!db.certificates[k]) db.certificates[k] = {};
  return db.certificates[k];
};

export function saveCertificate(contract, record) {
  bucket(contract)[record.certId] = record;
  persist();
}

export function getCertificate(contract, certId) {
  return bucket(contract)[certId] || null;
}

export function listCertificates(contract, predicate = () => true) {
  return Object.values(bucket(contract)).filter(predicate);
}

// ---- PDF files (content-addressed by SHA-256) -----------------------------

const filePath = (sha256Hex) => path.join(FILES_DIR, `${sha256Hex.replace(/^0x/, "").toLowerCase()}.pdf`);

export function saveFile(sha256Hex, buffer) {
  fs.writeFileSync(filePath(sha256Hex), buffer);
}

export function readFile(sha256Hex) {
  const p = filePath(sha256Hex);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
