/** Batch issuance from a CSV file: many certificates in ONE transaction. */
import { useState } from "react";
import { Download, FileSpreadsheet, Layers, RotateCcw } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { describeError, explorerTxUrl } from "../../lib/chain";
import { downloadPdf } from "../../lib/pdf";
import { parseCsv, suggestCertId } from "../../lib/format";
import { findExistingIds, prepareCertificates, sendIssueTx, uploadRecords, validateCertificate, waitForTx } from "../../lib/issue";
import { useIssuer } from "./IssuerConsole";
import { Alert, Button, DataList, FileDrop, Hex, StatusBadge } from "../../components/ui";
import Progress from "../../components/Progress";

const MAX = 50;
const COLUMNS = ["certificateId", "studentId", "studentName", "studentEmail", "degree", "major", "honours", "graduationDate"];

const TEMPLATE = `${COLUMNS.join(",")}
,1155000001,Chan Tai Man,taiman@link.cuhk.edu.hk,Bachelor of Science,Computer Science,First Class Honours,2026-07-01
,1155000002,Lee Siu Ming,siuming@link.cuhk.edu.hk,Bachelor of Engineering,Computer Engineering,,2026-07-01
,1155000003,Nguyen Van An,vanan@link.cuhk.edu.hk,Bachelor of Science,Mathematics,Second Class Honours (Upper Division),2026-07-01
`;

const STEPS = [
  { key: "check", label: "Check IDs against the blockchain" },
  { key: "sign", label: "Sign in to records service" },
  { key: "pdf", label: "Generate PDFs and SHA-256 fingerprints" },
  { key: "tx", label: "Confirm ONE batch transaction in MetaMask" },
  { key: "mine", label: "Wait for block confirmation" },
  { key: "upload", label: "Store PDFs off-chain" },
];

/** Normalises CSV headers (case/space-insensitive) into our field names. */
function toCertificate(row, institutionName) {
  const get = (name) => {
    const key = Object.keys(row).find((k) => k.replace(/[\s_]/g, "").toLowerCase() === name.toLowerCase());
    return key ? row[key] : "";
  };
  return {
    certId: get("certificateId") || get("certId") || suggestCertId(institutionName),
    studentId: get("studentId"),
    studentName: get("studentName"),
    studentEmail: get("studentEmail"),
    degree: get("degree"),
    major: get("major"),
    honours: get("honours"),
    graduationDate: get("graduationDate"),
  };
}

export default function BatchIssue() {
  const wallet = useWallet();
  const { reloadCerts, loadMeta } = useIssuer();
  const institutionName = wallet.roles.institution?.name || "";

  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]); // { cert, errors }
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({});
  const [detail, setDetail] = useState({});
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const mark = (k, st, info) => {
    setStatus((s) => ({ ...s, [k]: st }));
    if (info !== undefined) setDetail((d) => ({ ...d, [k]: info }));
  };

  const onFile = async (f) => {
    setFile(f);
    setError("");
    setDone(null);
    setStatus({});
    const parsed = parseCsv(await f.text());
    if (!parsed.length) {
      setRows([]);
      setError("The CSV file has no data rows.");
      return;
    }
    if (parsed.length > MAX) setError(`Only the first ${MAX} rows are used (one transaction is limited to ${MAX}).`);
    const certs = parsed.slice(0, MAX).map((r) => toCertificate(r, institutionName));
    const seen = new Set();
    const existing = new Set(await findExistingIds(certs.map((c) => c.certId)).catch(() => []));
    setRows(
      certs.map((cert) => {
        const errors = validateCertificate(cert);
        if (seen.has(cert.certId)) errors.certId = "Duplicate ID in this file.";
        if (existing.has(cert.certId)) errors.certId = "ID already exists on-chain.";
        seen.add(cert.certId);
        return { cert, errors };
      })
    );
  };

  const validRows = rows.filter((r) => Object.keys(r.errors).length === 0);
  const invalidCount = rows.length - validRows.length;

  const issue = async () => {
    setBusy(true);
    setError("");
    setStatus({});
    setDetail({});
    let step = "check";
    try {
      mark("check", "active");
      const items = validRows.map((r) => r.cert);
      const dupes = await findExistingIds(items.map((c) => c.certId));
      if (dupes.length) throw new Error(`Already on-chain: ${dupes.join(", ")}`);
      mark("check", "done", `${items.length} certificates`);

      step = "sign";
      mark("sign", "active");
      const token = await wallet.getApiToken();
      mark("sign", "done");

      step = "pdf";
      mark("pdf", "active");
      const prepared = await prepareCertificates(items, { institutionName, issuer: wallet.account }, (n, total) =>
        setDetail((d) => ({ ...d, pdf: `${n}/${total}` }))
      );
      mark("pdf", "done");

      step = "tx";
      mark("tx", "active");
      const tx = await sendIssueTx(await wallet.getSigner(), prepared);
      mark("tx", "done", `${tx.hash.slice(0, 14)}…`);

      step = "mine";
      mark("mine", "active");
      const chain = await waitForTx(tx);
      mark("mine", "done", `block #${chain.blockNumber}`);

      step = "upload";
      mark("upload", "active");
      let uploaded = true;
      try {
        await uploadRecords(token, prepared);
        mark("upload", "done");
      } catch (err) {
        uploaded = false;
        mark("upload", "error", err.message);
      }
      setDone({ prepared, ...chain, uploaded });
      reloadCerts();
      if (uploaded) loadMeta();
    } catch (err) {
      mark(step, "error");
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setRows([]);
    setDone(null);
    setStatus({});
    setDetail({});
    setError("");
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "certchain-batch-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="stack-lg">
      <div className="grid-2">
        <div className="card stack">
          <div className="row between wrap">
            <h3>Upload a CSV</h3>
            <Button size="sm" variant="ghost" icon={FileSpreadsheet} onClick={downloadTemplate}>
              Download template
            </Button>
          </div>
          <FileDrop file={file} onFile={onFile} accept=".csv,text/csv" label="Drop a CSV file here" />
          <p className="muted small">
            Columns: <code>{COLUMNS.join(", ")}</code>. Leave <code>certificateId</code> empty to auto-generate. Up to{" "}
            {MAX} rows are issued atomically in a single transaction — if any row is invalid on-chain, none are issued.
          </p>
          {error && <Alert tone={done ? "warning" : "error"}>{error}</Alert>}
          {rows.length > 0 && !done && (
            <div className="row wrap">
              <Button icon={Layers} loading={busy} disabled={!validRows.length || invalidCount > 0} onClick={issue}>
                Issue {validRows.length} certificate{validRows.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" icon={RotateCcw} onClick={reset} disabled={busy}>
                Clear
              </Button>
              {invalidCount > 0 && <span className="small field-error">Fix {invalidCount} invalid row(s) first.</span>}
            </div>
          )}
        </div>
        <div className="card stack-sm">
          <h3>Progress</h3>
          <Progress steps={STEPS} status={status} detail={detail} />
          {done && !done.uploaded && (
            <Alert tone="warning">
              Certificates are valid on-chain but the PDFs were not stored for students. Download them below and
              share them manually, or check the backend.
            </Alert>
          )}
          {done && (
            <DataList
              rows={[
                ["Transaction", <Hex key="t" value={done.txHash} href={explorerTxUrl(done.txHash)} />],
                ["Block", `#${done.blockNumber}`],
                ["Gas used (total)", Number(done.gasUsed).toLocaleString()],
                ["Gas per certificate", Math.round(Number(done.gasUsed) / done.prepared.length).toLocaleString()],
              ]}
            />
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Certificate ID</th>
                <th>Student</th>
                <th>Degree</th>
                <th>Graduation</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(done ? done.prepared.map((cert) => ({ cert, errors: {} })) : rows).map(({ cert, errors }, i) => {
                const errs = Object.entries(errors);
                const issued = done?.prepared.find((p) => p.certId === cert.certId);
                return (
                  <tr key={`${cert.certId}-${i}`} className={errs.length ? "row-error" : ""}>
                    <td>
                      <code>{cert.certId}</code>
                    </td>
                    <td>
                      {cert.studentName || "—"}
                      <div className="muted small">{cert.studentId}</div>
                    </td>
                    <td>
                      {cert.degree}
                      {cert.major && <div className="muted small">{cert.major}</div>}
                    </td>
                    <td>{cert.graduationDate}</td>
                    <td>
                      {issued ? (
                        <StatusBadge status="valid" />
                      ) : errs.length ? (
                        <span className="field-error small">{errs.map(([k, v]) => `${k}: ${v}`).join(" ")}</span>
                      ) : (
                        <span className="muted small">Ready</span>
                      )}
                    </td>
                    <td className="right">
                      {issued && (
                        <button className="icon-btn" title="Download PDF" onClick={() => downloadPdf(issued.pdf, `${issued.certId}.pdf`)}>
                          <Download size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {done && (
        <Button variant="secondary" icon={RotateCcw} onClick={reset}>
          Start a new batch
        </Button>
      )}
    </div>
  );
}
