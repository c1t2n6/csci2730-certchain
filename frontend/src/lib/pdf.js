/**
 * Certificate PDF generation (client-side, jsPDF) and certificate-ID extraction.
 *
 * The PDF is generated exactly once, at issuance. Its SHA-256 hash is what gets
 * written on-chain, and the same bytes are stored for the student to download -
 * so any later modification to the file (even one character) changes the hash.
 */
import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export const APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "");
export const verifyUrl = (certId) => `${APP_URL}/verify/${encodeURIComponent(certId)}`;

const KEYWORD_PREFIX = "certchain-id:";

/**
 * jsPDF's built-in fonts only cover Latin-1, so accents outside it
 * (e.g. Vietnamese "Nguyễn") are folded to their base letters for rendering.
 */
const pdfSafe = (text) =>
  String(text ?? "")
    .replace(/[đĐ]/g, (ch) => (ch === "đ" ? "d" : "D"))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

/**
 * @param {object} c  { certId, institutionName, studentName, studentId, degree, major, honours, graduationDate, issuer }
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateCertificatePdf(input) {
  const c = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, pdfSafe(v)]));
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const H = 210;
  const cx = W / 2;
  const ink = [17, 24, 39];
  const muted = [100, 116, 139];
  const accent = [30, 58, 138];

  doc.setProperties({
    title: `Academic Certificate ${c.certId}`,
    subject: `${c.degree} - ${c.studentName}`,
    author: c.institutionName,
    creator: "CertChain",
    keywords: `${KEYWORD_PREFIX}${c.certId}`,
  });

  // Frame
  doc.setDrawColor(...accent);
  doc.setLineWidth(1.2);
  doc.rect(10, 10, W - 20, H - 20);
  doc.setLineWidth(0.3);
  doc.rect(13, 13, W - 26, H - 26);

  // Header
  doc.setTextColor(...accent);
  doc.setFont("times", "bold");
  doc.setFontSize(24);
  doc.text(c.institutionName.toUpperCase(), cx, 36, { align: "center", maxWidth: W - 60 });

  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setCharSpace(1.6);
  doc.text("CERTIFICATE OF ACADEMIC AWARD", cx, 46, { align: "center" });
  doc.setCharSpace(0);

  doc.setDrawColor(...muted);
  doc.setLineWidth(0.2);
  doc.line(cx - 30, 51, cx + 30, 51);

  // Body
  doc.setTextColor(...ink);
  doc.setFont("times", "italic");
  doc.setFontSize(14);
  doc.text("This is to certify that", cx, 66, { align: "center" });

  doc.setFont("times", "bold");
  doc.setFontSize(30);
  doc.text(c.studentName, cx, 82, { align: "center", maxWidth: W - 60 });

  doc.setFont("times", "italic");
  doc.setFontSize(13);
  doc.text("having fulfilled all the requirements, was conferred the degree of", cx, 96, { align: "center" });

  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...accent);
  doc.text(c.degree, cx, 109, { align: "center", maxWidth: W - 60 });

  doc.setTextColor(...ink);
  doc.setFont("times", "normal");
  doc.setFontSize(13);
  let y = 119;
  if (c.major) {
    doc.text(`Major in ${c.major}`, cx, y, { align: "center" });
    y += 8;
  }
  if (c.honours) {
    doc.text(`with ${c.honours}`, cx, y, { align: "center" });
    y += 8;
  }
  doc.text(`on ${formatDate(c.graduationDate)}`, cx, y, { align: "center" });

  // Signature line
  doc.setDrawColor(...ink);
  doc.setLineWidth(0.3);
  doc.line(cx - 35, 166, cx + 35, 166);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Registrar", cx, 171, { align: "center" });

  // Footer details (left)
  const left = 22;
  doc.setFontSize(8.5);
  const rows = [
    ["Certificate ID", c.certId],
    ["Student ID", c.studentId],
    ["Issued on", new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })],
    ["Issuer wallet", `${c.issuer.slice(0, 10)}...${c.issuer.slice(-8)}`],
  ];
  rows.forEach(([k, v], i) => {
    const ry = 158 + i * 6;
    doc.setTextColor(...muted);
    doc.text(k, left, ry);
    doc.setTextColor(...ink);
    doc.setFont("courier", "normal");
    doc.text(String(v), left + 26, ry);
    doc.setFont("helvetica", "normal");
  });

  // QR code (right)
  const qr = await QRCode.toDataURL(verifyUrl(c.certId), { margin: 0, width: 360, errorCorrectionLevel: "M" });
  const qrSize = 30;
  const qx = W - 22 - qrSize;
  doc.addImage(qr, "PNG", qx, 148, qrSize, qrSize);
  doc.setTextColor(...muted);
  doc.setFontSize(7.5);
  doc.text("Scan to verify on the blockchain", qx + qrSize / 2, 183, { align: "center" });

  return new Uint8Array(doc.output("arraybuffer"));
}

/**
 * Best-effort extraction of the certificate ID embedded in the PDF metadata.
 * Returns null if the file was not produced by CertChain (or the metadata was stripped).
 */
export function extractCertId(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const m = text.match(/certchain-id:([A-Za-z0-9._-]{1,64})/);
  return m ? m[1] : null;
}

/** Triggers a browser download of PDF bytes. */
export function downloadPdf(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
