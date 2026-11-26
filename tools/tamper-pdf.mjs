#!/usr/bin/env node
/**
 * Demo helper: simulates a forger editing a certificate PDF.
 *
 *   node tools/tamper-pdf.mjs <input.pdf> "<text to find>" "<replacement>" [output.pdf]
 *
 * CertChain PDFs store their text uncompressed, so a same-length replacement
 * keeps the file perfectly readable in any PDF viewer - it *looks* genuine.
 * But its SHA-256 fingerprint changes, so the verifier reports it as INVALID.
 *
 * Example:
 *   node tools/tamper-pdf.mjs CUHK-2026-AB12CD.pdf "Second Class Honours" "First Class Honours"
 *
 * (Avoid parentheses in the search text: PDF escapes them inside strings.)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const [input, find, replace, output] = process.argv.slice(2);
if (!input || !find || replace === undefined) {
  console.error('Usage: node tools/tamper-pdf.mjs <input.pdf> "<find>" "<replace>" [output.pdf]');
  process.exit(1);
}

const original = fs.readFileSync(input);
const text = original.toString("latin1");
if (!text.includes(find)) {
  console.error(`Text "${find}" was not found in the PDF content.`);
  process.exit(1);
}

// Keep the byte length identical so the PDF cross-reference table stays valid.
let rep = replace;
if (rep.length > find.length) {
  console.warn(`Replacement is longer than the original; truncating to ${find.length} characters.`);
  rep = rep.slice(0, find.length);
} else {
  const pad = find.length - rep.length;
  rep = " ".repeat(Math.floor(pad / 2)) + rep + " ".repeat(Math.ceil(pad / 2));
}

const tampered = Buffer.from(text.split(find).join(rep), "latin1");
const out = output || input.replace(/\.pdf$/i, "") + "-tampered.pdf";
fs.writeFileSync(out, tampered);

const sha = (b) => "0x" + crypto.createHash("sha256").update(b).digest("hex");
console.log(`Original SHA-256 : ${sha(original)}`);
console.log(`Tampered SHA-256 : ${sha(tampered)}`);
console.log(`Written          : ${out}`);
