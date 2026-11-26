/** Single certificate issuance. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, FilePlus2, RefreshCw, ExternalLink, Upload } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { describeError, explorerTxUrl } from "../../lib/chain";
import { generateCertificatePdf, downloadPdf } from "../../lib/pdf";
import { suggestCertId } from "../../lib/format";
import { DEGREES, EMPTY_CERT, HONOURS, findExistingIds, prepareCertificates, sendIssueTx, waitForTx, uploadRecords, validateCertificate } from "../../lib/issue";
import { useIssuer } from "./IssuerConsole";
import { Alert, Button, DataList, Field, Hex, Modal } from "../../components/ui";
import Progress from "../../components/Progress";

const STEPS = [
  { key: "check", label: "Validate details and check for duplicate ID on-chain" },
  { key: "sign", label: "Sign in to records service (signature, no gas)" },
  { key: "pdf", label: "Generate PDF and compute SHA-256 fingerprint" },
  { key: "tx", label: "Confirm transaction in MetaMask" },
  { key: "mine", label: "Wait for block confirmation" },
  { key: "upload", label: "Store PDF and holder details off-chain" },
];

export default function IssueForm() {
  const wallet = useWallet();
  const { reloadCerts, loadMeta } = useIssuer();
  const institutionName = wallet.roles.institution?.name || "";

  const [form, setForm] = useState(() => ({ ...EMPTY_CERT, certId: suggestCertId(institutionName) }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({});
  const [detail, setDetail] = useState({});
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { prepared, txHash, blockNumber, gasUsed, uploaded }
  const [preview, setPreview] = useState(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mark = (key, st, info) => {
    setStatus((s) => ({ ...s, [key]: st }));
    if (info !== undefined) setDetail((d) => ({ ...d, [key]: info }));
  };

  const showPreview = async () => {
    const errs = validateCertificate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const pdf = await generateCertificatePdf({ ...form, institutionName, issuer: wallet.account });
    setPreview(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })));
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validateCertificate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError("");
    setStatus({});
    setDetail({});
    let step = "check";
    try {
      mark("check", "active");
      if ((await findExistingIds([form.certId])).length) {
        setErrors({ certId: "This certificate ID already exists on the blockchain." });
        throw new Error("Duplicate certificate ID - choose another one.");
      }
      mark("check", "done");

      step = "sign";
      mark("sign", "active");
      const token = await wallet.getApiToken();
      mark("sign", "done");

      step = "pdf";
      mark("pdf", "active");
      const prepared = await prepareCertificates([form], { institutionName, issuer: wallet.account });
      mark("pdf", "done", prepared[0].hash.slice(0, 18) + "…");

      step = "tx";
      mark("tx", "active");
      const signer = await wallet.getSigner();
      const tx = await sendIssueTx(signer, prepared);
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
      setDone({ prepared: prepared[0], all: prepared, token, ...chain, uploaded });
      reloadCerts();
      if (uploaded) loadMeta();
    } catch (err) {
      mark(step, "error");
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const retryUpload = async () => {
    try {
      mark("upload", "active", "");
      await uploadRecords(done.token, done.all);
      mark("upload", "done", "");
      setDone((d) => ({ ...d, uploaded: true }));
      loadMeta();
    } catch (err) {
      mark("upload", "error", err.message);
    }
  };

  const reset = () => {
    setForm({ ...EMPTY_CERT, certId: suggestCertId(institutionName) });
    setDone(null);
    setStatus({});
    setDetail({});
    setError("");
  };

  if (done) {
    const p = done.prepared;
    return (
      <div className="grid-2">
        <div className="card stack">
          <Alert tone="success" title="Certificate issued and anchored on-chain">
            {p.studentName} · {p.degree}
          </Alert>
          <DataList
            rows={[
              ["Certificate ID", <code key="c">{p.certId}</code>],
              ["SHA-256 (on-chain)", <Hex key="h" value={p.hash} />],
              ["Transaction", <Hex key="t" value={done.txHash} href={explorerTxUrl(done.txHash)} />],
              ["Block", `#${done.blockNumber}`],
              ["Gas used", Number(done.gasUsed).toLocaleString()],
            ]}
          />
          {!done.uploaded && (
            <Alert tone="warning" title="PDF not stored in the records service">
              The certificate is valid on-chain, but the student cannot download it yet.{" "}
              <Button size="sm" variant="secondary" icon={Upload} onClick={retryUpload}>
                Retry upload
              </Button>
            </Alert>
          )}
          <div className="row wrap">
            <Button icon={Download} onClick={() => downloadPdf(p.pdf, `${p.certId}.pdf`)}>
              Download PDF
            </Button>
            <Link className="btn btn-secondary" to={`/verify/${encodeURIComponent(p.certId)}`}>
              <ExternalLink size={16} /> Verification page
            </Link>
            <Button variant="ghost" icon={FilePlus2} onClick={reset}>
              Issue another
            </Button>
          </div>
        </div>
        <div className="card stack-sm">
          <h3>Issuance steps</h3>
          <Progress steps={STEPS} status={status} detail={detail} />
        </div>
      </div>
    );
  }

  return (
    <div className="issue-layout">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="form-section">
          <h3>Certificate</h3>
          <div className="form-grid">
            <Field label="Issuing institution">
              <input value={institutionName} disabled />
            </Field>
            <Field label="Certificate ID" required error={errors.certId} hint="Must be unique across the whole registry.">
              <div className="input-group">
                <input value={form.certId} onChange={set("certId")} spellCheck={false} />
                <button type="button" className="icon-btn" title="Generate new ID" onClick={() => setForm((f) => ({ ...f, certId: suggestCertId(institutionName) }))}>
                  <RefreshCw size={15} />
                </button>
              </div>
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Student</h3>
          <div className="form-grid">
            <Field label="Full name" required error={errors.studentName}>
              <input value={form.studentName} onChange={set("studentName")} placeholder="Chan Tai Man" />
            </Field>
            <Field label="Student ID" required error={errors.studentId} hint="Stored on-chain only as a keccak-256 hash.">
              <input value={form.studentId} onChange={set("studentId")} placeholder="1155123456" />
            </Field>
            <Field label="E-mail" error={errors.studentEmail} hint="Used to link the certificate to the student's account.">
              <input type="email" value={form.studentEmail} onChange={set("studentEmail")} placeholder="student@link.cuhk.edu.hk" />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Award</h3>
          <div className="form-grid">
            <Field label="Degree" required error={errors.degree} hint="Recorded on-chain.">
              <input list="degree-options" value={form.degree} onChange={set("degree")} placeholder="Bachelor of Science" />
              <datalist id="degree-options">
                {DEGREES.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Major">
              <input value={form.major} onChange={set("major")} placeholder="Computer Science" />
            </Field>
            <Field label="Honours">
              <select value={form.honours} onChange={set("honours")}>
                {HONOURS.map((h) => (
                  <option key={h} value={h}>
                    {h || "—"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Graduation date" required error={errors.graduationDate}>
              <input type="date" value={form.graduationDate} onChange={set("graduationDate")} />
            </Field>
          </div>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        <div className="row wrap">
          <Button type="submit" icon={FilePlus2} loading={busy}>
            Issue on blockchain
          </Button>
          <Button type="button" variant="secondary" icon={Eye} onClick={showPreview} disabled={busy}>
            Preview PDF
          </Button>
        </div>
      </form>

      <aside className="card stack-sm">
        <h3>What happens</h3>
        <Progress steps={STEPS} status={status} detail={detail} />
        <p className="muted small">
          On-chain: certificate ID, SHA-256 of the PDF, hashed student ID, degree, issuer, timestamp. Name, e-mail and
          the PDF are stored off-chain.
        </p>
      </aside>

      <Modal open={Boolean(preview)} title="Certificate preview" onClose={() => setPreview(null)}>
        {preview && <iframe className="pdf-frame" src={preview} title="Certificate preview" />}
        <p className="muted small">Preview only — the issued file is regenerated, so its fingerprint will differ.</p>
      </Modal>
    </div>
  );
}
