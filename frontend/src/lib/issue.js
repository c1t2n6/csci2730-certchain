/**
 * Issuance pipeline shared by single and batch issuance:
 *   validate -> generate PDF -> SHA-256 -> on-chain transaction -> store PDF off-chain
 */
import { api } from "./api";
import { readContract, sha256, studentIdHash, writeContract } from "./chain";
import { generateCertificatePdf } from "./pdf";
import { CERT_ID_RE } from "./format";

export const HONOURS = [
  "",
  "First Class Honours",
  "Second Class Honours (Upper Division)",
  "Second Class Honours (Lower Division)",
  "Third Class Honours",
  "Distinction",
  "Merit",
];

export const DEGREES = [
  "Bachelor of Science",
  "Bachelor of Engineering",
  "Bachelor of Arts",
  "Bachelor of Business Administration",
  "Master of Science",
  "Master of Philosophy",
  "Doctor of Philosophy",
];

export const EMPTY_CERT = {
  certId: "",
  studentId: "",
  studentName: "",
  studentEmail: "",
  degree: "",
  major: "",
  honours: "",
  graduationDate: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns { field: message } for every invalid field (empty object = valid). */
export function validateCertificate(c) {
  const errors = {};
  if (!CERT_ID_RE.test(c.certId || "")) errors.certId = "3–64 characters: letters, digits, '.', '_' or '-'.";
  if (!/^[A-Za-z0-9-]{4,20}$/.test((c.studentId || "").trim())) errors.studentId = "4–20 letters, digits or dashes.";
  if ((c.studentName || "").trim().length < 2) errors.studentName = "Required.";
  if (c.studentEmail && !EMAIL_RE.test(c.studentEmail)) errors.studentEmail = "Invalid e-mail.";
  if ((c.degree || "").trim().length < 3) errors.degree = "Required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.graduationDate || "")) errors.graduationDate = "Use YYYY-MM-DD.";
  return errors;
}

/** Checks which certificate IDs already exist on-chain. */
export async function findExistingIds(ids) {
  const flags = await Promise.all(ids.map((id) => readContract.certificateExists(id)));
  return ids.filter((_, i) => flags[i]);
}

/** Generates PDFs and hashes for each certificate. */
export async function prepareCertificates(items, { institutionName, issuer }, onProgress) {
  const prepared = [];
  for (let i = 0; i < items.length; i++) {
    const c = { ...items[i], degree: items[i].degree.trim(), studentId: items[i].studentId.trim().toUpperCase() };
    const pdf = await generateCertificatePdf({ ...c, institutionName, issuer });
    prepared.push({ ...c, pdf, hash: sha256(pdf) });
    onProgress?.(i + 1, items.length);
  }
  return prepared;
}

/** Sends one transaction (single or batch) - resolves once the wallet has signed and broadcast it. */
export function sendIssueTx(signer, prepared) {
  const contract = writeContract(signer);
  return prepared.length === 1
    ? contract.issueCertificate(prepared[0].certId, prepared[0].hash, studentIdHash(prepared[0].studentId), prepared[0].degree)
    : contract.issueCertificatesBatch(
        prepared.map((p) => p.certId),
        prepared.map((p) => p.hash),
        prepared.map((p) => studentIdHash(p.studentId)),
        prepared.map((p) => p.degree)
      );
}

/** Waits for the transaction to be mined and summarises the receipt. */
export async function waitForTx(tx) {
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Transaction reverted.");
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

/** Stores PDFs + personal details in the records service (verified there against the chain). */
export function uploadRecords(token, prepared) {
  const meta = prepared.map(({ certId, studentId, studentName, studentEmail, degree, major, honours, graduationDate }) => ({
    certId,
    studentId,
    studentName,
    studentEmail,
    degree,
    major,
    honours,
    graduationDate,
  }));
  return api.uploadCertificates(
    token,
    meta,
    prepared.map((p) => p.pdf)
  );
}
