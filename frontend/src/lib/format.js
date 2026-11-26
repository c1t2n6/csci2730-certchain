export const shortHex = (hex, head = 6, tail = 4) =>
  !hex ? "" : hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;

export const formatTimestamp = (seconds) =>
  !seconds
    ? "—"
    : new Date(Number(seconds) * 1000).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

export const CERT_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;

/** Suggests an ID like CUHK-2026-4F7A21 */
export function suggestCertId(institutionName = "CERT") {
  const prefix =
    (institutionName.match(/\b[A-Z]/g) || [])
      .join("")
      .replace(/^T(?=CU)/, "") // "The Chinese University..." -> "CUHK"
      .slice(0, 6) || "CERT";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${prefix}-${new Date().getFullYear()}-${rand}`;
}

/** Minimal RFC-4180 CSV parser (handles quoted fields and commas inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
}
