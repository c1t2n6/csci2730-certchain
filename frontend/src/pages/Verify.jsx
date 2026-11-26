/**
 * Public verification page.
 *   /verify            - upload a PDF (certificate ID detected automatically)
 *   /verify/:certId    - QR-code landing page; shows the live on-chain status
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Link2, PenLine, RotateCcw, Search, ShieldCheck, XCircle } from "lucide-react";
import { readContract, RESULT, sha256, toCertificate, writeContract, describeError, IS_DEPLOYED } from "../lib/chain";
import { api } from "../lib/api";
import { extractCertId, verifyUrl } from "../lib/pdf";
import { formatDate, formatTimestamp } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Alert, Button, CopyButton, DataList, Field, FileDrop, Hex, Spinner, StatusBadge } from "../components/ui";
import { Timeline, TxProof, useCertificateEvents, useInstitutions } from "../components/CertificateRecord";

const COPY = {
  authentic: {
    title: "Authentic certificate",
    text: (r) =>
      `This document is byte-for-byte identical to the certificate issued by ${r.institution} and it has not been revoked.`,
  },
  valid: {
    title: "Certificate record is active",
    text: (r) =>
      `${r.institution} issued this certificate and it has not been revoked. Upload the PDF you received to confirm that the document itself has not been altered.`,
  },
  invalid: {
    title: "Document has been modified",
    text: () =>
      "A certificate with this ID exists, but the fingerprint of this file does not match the one recorded on the blockchain. The document was altered or forged.",
  },
  revoked: {
    title: "Certificate revoked",
    text: (r) =>
      `This certificate was issued by ${r.institution} but revoked on ${formatTimestamp(r.cert.revokedAt)}. It is no longer valid.`,
  },
  notfound: {
    title: "No matching certificate",
    text: () => "No certificate with this ID or fingerprint exists on the blockchain registry.",
  },
};

export default function Verify() {
  const { certId: routeCertId } = useParams();
  const navigate = useNavigate();
  const wallet = useWallet();
  const institutions = useInstitutions();

  const [file, setFile] = useState(null);
  const [fileHash, setFileHash] = useState("");
  const [certIdInput, setCertIdInput] = useState(routeCertId || "");
  const [detectedId, setDetectedId] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordMsg, setRecordMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const events = useCertificateEvents(result?.cert ? result.certId : null, refreshKey);
  const issuedEvent = events.events.find((e) => e.type === "issued");

  const institutionName = (addr) => institutions[addr?.toLowerCase()] || "the issuing institution";

  /** Core verification routine - all checks are done against the smart contract. */
  const runVerification = useCallback(
    async ({ certId, hash }) => {
      setLoading(true);
      setError("");
      setRecordMsg("");
      try {
        let status;
        let id = certId?.trim() || "";
        if (hash && id) {
          status = RESULT[Number(await readContract.verifyCertificate(id, hash))];
          if (status === "notfound") {
            // ID may be mistyped - fall back to a lookup by fingerprint.
            const [r, foundId] = await readContract.verifyByHash(hash);
            if (Number(r) !== 0) {
              status = RESULT[Number(r)];
              id = foundId;
            }
          }
        } else if (hash) {
          const [r, foundId] = await readContract.verifyByHash(hash);
          status = RESULT[Number(r)];
          id = foundId;
        } else {
          const raw = await readContract.getCertificate(id);
          status = raw.issuedAt === 0n ? "notfound" : raw.revoked ? "revoked" : "valid";
        }

        let cert = null;
        let meta = null;
        if (status !== "notfound" && id) {
          cert = toCertificate(await readContract.getCertificate(id));
          meta = await api.publicCertificate(id).catch(() => null);
        }
        setResult({ status, certId: id, cert, meta, hash });
      } catch (err) {
        setError(describeError(err));
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // QR landing: check the on-chain status immediately.
  useEffect(() => {
    if (routeCertId && IS_DEPLOYED) {
      setCertIdInput(routeCertId);
      runVerification({ certId: routeCertId });
    }
  }, [routeCertId, runVerification]);

  const onFile = async (f) => {
    setFile(f);
    setResult(null);
    setError("");
    if (f.type && f.type !== "application/pdf") {
      setError("Please select a PDF file.");
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const hash = sha256(bytes);
    const embedded = extractCertId(bytes);
    setFileHash(hash);
    setDetectedId(embedded);
    const id = embedded || certIdInput;
    if (embedded) setCertIdInput(embedded);
    runVerification({ certId: id, hash });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!fileHash && !certIdInput.trim()) {
      setError("Upload a certificate PDF or enter a certificate ID.");
      return;
    }
    runVerification({ certId: certIdInput, hash: fileHash || undefined });
  };

  const reset = () => {
    setFile(null);
    setFileHash("");
    setDetectedId(null);
    setResult(null);
    setCertIdInput("");
    setError("");
    if (routeCertId) navigate("/verify");
  };

  const recordOnChain = async () => {
    setRecording(true);
    setRecordMsg("");
    try {
      const signer = await wallet.getSigner();
      const tx = await writeContract(signer).recordVerification(result.certId, fileHash || result.cert.certHash);
      await tx.wait();
      setRecordMsg("Verification recorded on-chain.");
      setRefreshKey((k) => k + 1);
      setResult((r) => ({ ...r, cert: { ...r.cert, verificationCount: r.cert.verificationCount + 1 } }));
    } catch (err) {
      setRecordMsg(describeError(err));
    } finally {
      setRecording(false);
    }
  };

  const copy = result ? COPY[result.status] : null;
  const hashMatches = result?.cert && result.hash && result.cert.certHash === result.hash;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Verify a certificate</h1>
          <p className="muted">
            The file is hashed in your browser with SHA-256 and checked against the Ethereum smart contract. Nothing is
            uploaded.
          </p>
        </div>
      </div>

      <div className="verify-layout">
        <form className="card stack" onSubmit={onSubmit}>
          <FileDrop file={file} onFile={onFile} />
          {fileHash && (
            <DataList
              rows={[
                ["SHA-256 of file", <Hex key="h" value={fileHash} />],
                detectedId && ["Detected ID", <code key="d">{detectedId}</code>],
              ]}
            />
          )}
          <Field label="Certificate ID" hint="Optional when uploading a CertChain PDF — it is detected automatically.">
            <input
              value={certIdInput}
              onChange={(e) => setCertIdInput(e.target.value)}
              placeholder="e.g. CUHK-2026-4F7A21"
              spellCheck={false}
            />
          </Field>
          <div className="row">
            <Button type="submit" icon={Search} loading={loading} disabled={!IS_DEPLOYED}>
              Verify
            </Button>
            {(file || result || certIdInput) && (
              <Button type="button" variant="ghost" icon={RotateCcw} onClick={reset}>
                Reset
              </Button>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </form>

        <div className="stack">
          {!result && !loading && (
            <div className="card placeholder">
              <ShieldCheck size={32} />
              <strong>Result appears here</strong>
              <p className="muted">
                Possible outcomes: <StatusBadge status="authentic" /> <StatusBadge status="invalid" />{" "}
                <StatusBadge status="revoked" /> <StatusBadge status="notfound" />
              </p>
            </div>
          )}
          {loading && (
            <div className="card placeholder">
              <Spinner size={24} />
              <span className="muted">Querying the blockchain…</span>
            </div>
          )}

          {result && !loading && (
            <>
              <div className={`card result result-${result.status}`}>
                <div className="result-head">
                  <StatusBadge status={result.status} />
                  <h2>{copy.title}</h2>
                </div>
                <p>{copy.text({ ...result, institution: institutionName(result.cert?.issuer) })}</p>
                {result.status === "revoked" && result.cert?.revokeReason && (
                  <p className="result-reason">Reason given by issuer: “{result.cert.revokeReason}”</p>
                )}
                {result.cert && result.hash && (
                  <div className="hash-compare">
                    <div>
                      <span className="muted small">Uploaded file</span>
                      <code>{result.hash}</code>
                    </div>
                    <div>
                      <span className="muted small">Recorded on-chain</span>
                      <code>{result.cert.certHash}</code>
                    </div>
                    <span className={`match ${hashMatches ? "ok" : "bad"}`}>
                      {hashMatches ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      {hashMatches ? "Fingerprints match" : "Fingerprints differ"}
                    </span>
                  </div>
                )}
              </div>

              {result.cert && (
                <div className="grid-2">
                  <div className="card stack-sm">
                    <h3>Blockchain record</h3>
                    <DataList
                      rows={[
                        ["Certificate ID", <code key="id">{result.certId}</code>],
                        ["Degree", result.cert.degree],
                        ["Issued by", institutionName(result.cert.issuer)],
                        ["Issuer wallet", <Hex key="iw" value={result.cert.issuer} />],
                        ["Issued at", formatTimestamp(result.cert.issuedAt)],
                        result.cert.revoked && ["Revoked at", formatTimestamp(result.cert.revokedAt)],
                        ["Verifications logged", result.cert.verificationCount],
                      ]}
                    />
                  </div>
                  <div className="card stack-sm">
                    <h3>Certificate holder</h3>
                    {result.meta ? (
                      <DataList
                        rows={[
                          ["Name", <strong key="n">{result.meta.studentName}</strong>],
                          ["Student ID", <code key="s">{result.meta.studentIdMasked}</code>],
                          result.meta.major && ["Major", result.meta.major],
                          result.meta.honours && ["Honours", result.meta.honours],
                          ["Graduation", formatDate(result.meta.graduationDate)],
                        ]}
                      />
                    ) : (
                      <p className="muted">Holder details are not available from the records service.</p>
                    )}
                    <p className="muted small">
                      Personal details are kept off-chain. The blockchain proves the document; the name printed on it
                      should match the person presenting it.
                    </p>
                  </div>
                </div>
              )}

              {result.cert && (
                <div className="grid-2">
                  <div className="card stack-sm">
                    <h3>Proof of issuance</h3>
                    {issuedEvent ? <TxProof txHash={issuedEvent.txHash} /> : events.loading ? <Spinner /> : <p className="muted">Not available.</p>}
                  </div>
                  <div className="card stack-sm">
                    <h3>History</h3>
                    {events.loading ? <Spinner /> : <Timeline events={events.events} institutions={institutions} />}
                  </div>
                </div>
              )}

              {result.cert && (
                <div className="card row wrap between">
                  <div className="row wrap">
                    <span className="muted small">Shareable link</span>
                    <code className="small">{verifyUrl(result.certId)}</code>
                    <CopyButton value={verifyUrl(result.certId)} label="Copy link" />
                  </div>
                  <div className="row wrap">
                    {wallet.account ? (
                      <Button variant="secondary" size="sm" icon={PenLine} loading={recording} onClick={recordOnChain}>
                        Record verification on-chain
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" icon={Link2} onClick={wallet.connect}>
                        Connect wallet to log this check
                      </Button>
                    )}
                  </div>
                  {recordMsg && <span className="small muted full">{recordMsg}</span>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
