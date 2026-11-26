/**
 * Off-chain certificate records.
 *
 * Trust model: the backend is only a convenience store for personal data and the
 * PDF files. It refuses to store anything that does not match the blockchain:
 *   - the uploader must be the wallet recorded as `issuer` on-chain,
 *   - SHA-256(file) must equal the `certHash` on-chain,
 *   - keccak256(studentId) must equal the `studentIdHash` on-chain.
 * So even a compromised backend cannot make a forged certificate verify as
 * authentic - verification always happens against the chain.
 */
import { Router } from "express";
import multer from "multer";
import { config } from "./config.js";
import { requireRole } from "./auth.js";
import { getContract, getDeployment, sha256Hex, studentIdHash } from "./chain.js";
import * as store from "./store.js";

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPdfBytes, files: 50 },
});

const httpError = (status, message) => Object.assign(new Error(message), { status });
const contractAddress = () => getDeployment().address;
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);

const maskStudentId = (id) => (id.length <= 4 ? "****" : `${"*".repeat(id.length - 4)}${id.slice(-4)}`);

const publicView = (r) => ({
  certId: r.certId,
  studentName: r.studentName,
  studentIdMasked: maskStudentId(r.studentId),
  degree: r.degree,
  major: r.major,
  honours: r.honours,
  graduationDate: r.graduationDate,
  institutionName: r.institutionName,
  hasFile: true,
});

const privateView = (r) => ({ ...publicView(r), studentId: r.studentId, studentEmail: r.studentEmail, issuer: r.issuer, certHash: r.certHash, uploadedAt: r.uploadedAt });

// ---------------------------------------------------------------------------
// POST /api/certificates  - store PDFs + metadata after the on-chain issuance
//   multipart/form-data:
//     meta     JSON array [{certId, studentId, studentName, studentEmail, degree, major, honours, graduationDate}]
//     file_0.. one PDF per meta entry (same order)
// ---------------------------------------------------------------------------
router.post("/", requireRole("issuer", "admin"), upload.any(), async (req, res, next) => {
  try {
    let items;
    try {
      items = JSON.parse(req.body.meta || "[]");
    } catch {
      throw httpError(400, "Invalid metadata payload.");
    }
    if (!Array.isArray(items) || items.length === 0) throw httpError(400, "No certificates supplied.");

    const files = new Map((req.files || []).map((f) => [f.fieldname, f]));
    const contract = getContract();
    const institution = await contract.getInstitution(req.user.address);
    const saved = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const certId = clean(item.certId, 64);
      const file = files.get(`file_${i}`);
      if (!file) throw httpError(400, `Missing PDF for certificate ${certId}.`);

      const onChain = await contract.getCertificate(certId);
      if (onChain.issuedAt === 0n) throw httpError(409, `Certificate ${certId} is not on the blockchain yet.`);
      if (onChain.issuer.toLowerCase() !== req.user.address.toLowerCase()) {
        throw httpError(403, `Certificate ${certId} was issued by a different institution.`);
      }
      const hash = sha256Hex(file.buffer);
      if (hash !== onChain.certHash) throw httpError(422, `PDF for ${certId} does not match the on-chain hash.`);
      if (studentIdHash(item.studentId) !== onChain.studentIdHash) {
        throw httpError(422, `Student ID for ${certId} does not match the on-chain record.`);
      }

      store.saveFile(hash, file.buffer);
      const record = {
        certId,
        studentId: store.normaliseStudentId(item.studentId),
        studentName: clean(item.studentName),
        studentEmail: clean(item.studentEmail).toLowerCase(),
        degree: onChain.degree,
        major: clean(item.major),
        honours: clean(item.honours),
        graduationDate: clean(item.graduationDate, 20),
        institutionName: institution.name,
        issuer: onChain.issuer,
        certHash: hash,
        uploadedAt: new Date().toISOString(),
      };
      store.saveCertificate(contractAddress(), record);
      saved.push(record.certId);
    }
    res.status(201).json({ saved });
  } catch (err) {
    next(err);
  }
});

// GET /api/certificates/mine - certificates belonging to the signed-in student.
// Matching requires both the student ID and the e-mail the university recorded.
router.get("/mine", requireRole("student"), (req, res) => {
  const list = store.listCertificates(
    contractAddress(),
    (r) => r.studentId === req.user.studentId && (!r.studentEmail || r.studentEmail === req.user.email)
  );
  res.json({ certificates: list.map(privateView) });
});

// GET /api/certificates/issued - off-chain details for the institution's console.
router.get("/issued", requireRole("issuer", "admin"), (req, res) => {
  const me = req.user.address.toLowerCase();
  const list = store.listCertificates(contractAddress(), (r) => req.user.role === "admin" || r.issuer.toLowerCase() === me);
  res.json({ certificates: list.map(privateView) });
});

// GET /api/certificates/:certId/public - details a verifier needs (no e-mail, masked ID).
router.get("/:certId/public", (req, res, next) => {
  const record = store.getCertificate(contractAddress(), req.params.certId);
  if (!record) return next(httpError(404, "No off-chain details for this certificate."));
  res.json(publicView(record));
});

// GET /api/certificates/:certId/file - download the original PDF (owner or issuer only).
router.get("/:certId/file", requireRole("student", "issuer", "admin"), (req, res, next) => {
  const record = store.getCertificate(contractAddress(), req.params.certId);
  if (!record) return next(httpError(404, "Certificate not found."));

  const u = req.user;
  const allowed =
    u.role === "admin" ||
    (u.role === "issuer" && record.issuer.toLowerCase() === u.address.toLowerCase()) ||
    (u.role === "student" && record.studentId === u.studentId && (!record.studentEmail || record.studentEmail === u.email));
  if (!allowed) return next(httpError(403, "You cannot download this certificate."));

  const buffer = store.readFile(record.certHash);
  if (!buffer) return next(httpError(404, "PDF file missing on server."));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${record.certId}.pdf"`);
  res.send(buffer);
});
