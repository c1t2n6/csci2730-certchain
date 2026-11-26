/** Searchable list of certificates with revoke / download actions. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Download, ExternalLink, KeyRound, RefreshCw, Search } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { describeError, writeContract } from "../../lib/chain";
import { api } from "../../lib/api";
import { downloadPdf } from "../../lib/pdf";
import { formatTimestamp } from "../../lib/format";
import { useIssuer } from "./IssuerConsole";
import { Alert, Button, EmptyState, Field, Hex, Modal, Spinner, StatusBadge } from "../../components/ui";
import { useInstitutions } from "../../components/CertificateRecord";

const REASONS = ["Issued in error", "Academic misconduct", "Degree rescinded", "Replaced by a corrected certificate"];

export default function CertificateList() {
  const wallet = useWallet();
  const { certs, reloadCerts, meta, loadMeta } = useIssuer();
  const institutions = useInstitutions();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [revoking, setRevoking] = useState(null); // certificate
  const [reason, setReason] = useState(REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return certs.list
      .map((c) => ({ ...c, meta: meta.byId[c.certId] }))
      .filter((c) => (filter === "all" ? true : filter === "revoked" ? c.revoked : !c.revoked))
      .filter((c) => {
        if (!q) return true;
        return [c.certId, c.degree, c.meta?.studentName, c.meta?.studentId, c.meta?.major]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      });
  }, [certs.list, meta.byId, query, filter]);

  const canRevoke = (c) => !c.revoked && (wallet.roles.isAdmin || c.issuer.toLowerCase() === wallet.account.toLowerCase());

  const revoke = async () => {
    const text = (reason === "Other" ? customReason : reason).trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const signer = await wallet.getSigner();
      const tx = await writeContract(signer).revokeCertificate(revoking.certId, text);
      await tx.wait();
      setNotice(`${revoking.certId} revoked in transaction ${tx.hash.slice(0, 12)}…`);
      setRevoking(null);
      reloadCerts();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (certId) => {
    try {
      const token = await wallet.getApiToken();
      downloadPdf(await api.downloadFile(certId, token), `${certId}.pdf`);
    } catch (err) {
      setNotice("");
      setError(describeError(err));
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={meta.loaded ? "Search by ID, student, degree…" : "Search by certificate ID or degree…"}
            aria-label="Search certificates"
          />
        </div>
        <div className="segmented" role="group" aria-label="Filter by status">
          {["all", "active", "revoked"].map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={reloadCerts} loading={certs.loading}>
          Refresh
        </Button>
      </div>

      {!meta.loaded && (
        <Alert tone="info">
          Student names and e-mails are stored off-chain.{" "}
          <Button size="sm" variant="secondary" icon={KeyRound} loading={meta.loading} onClick={loadMeta}>
            Sign in to show student details
          </Button>
          {meta.error && <div className="field-error small">{meta.error}</div>}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}
      {error && !revoking && (
        <Alert tone="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {certs.error && <Alert tone="error">{certs.error}</Alert>}

      <div className="card table-card">
        {certs.loading && !certs.list.length ? (
          <div className="placeholder">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={certs.list.length ? "No matches" : "No certificates yet"}>
            {certs.list.length ? "Try a different search or filter." : "Issued certificates will be listed here."}
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Certificate</th>
                <th>Student</th>
                <th>Degree</th>
                {wallet.roles.isAdmin && <th>Issuer</th>}
                <th>Issued</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.certId}>
                  <td>
                    <code>{c.certId}</code>
                    <div className="small">
                      <Hex value={c.certHash} />
                    </div>
                  </td>
                  <td>
                    {c.meta ? (
                      <>
                        {c.meta.studentName}
                        <div className="muted small">{c.meta.studentId}</div>
                      </>
                    ) : (
                      <span className="muted small">hidden</span>
                    )}
                  </td>
                  <td>
                    {c.degree}
                    {c.meta?.major && <div className="muted small">{c.meta.major}</div>}
                  </td>
                  {wallet.roles.isAdmin && <td className="small">{institutions[c.issuer.toLowerCase()] || <Hex value={c.issuer} />}</td>}
                  <td className="small">{formatTimestamp(c.issuedAt)}</td>
                  <td>
                    <StatusBadge status={c.revoked ? "revoked" : "valid"} />
                    {c.revoked && <div className="muted small" title={c.revokeReason}>{c.revokeReason}</div>}
                  </td>
                  <td className="right nowrap">
                    <Link className="icon-btn" to={`/verify/${encodeURIComponent(c.certId)}`} title="Open verification page">
                      <ExternalLink size={15} />
                    </Link>
                    {c.meta && (
                      <button className="icon-btn" title="Download PDF" onClick={() => download(c.certId)}>
                        <Download size={15} />
                      </button>
                    )}
                    {canRevoke(c) && (
                      <button className="icon-btn danger" title="Revoke" onClick={() => setRevoking(c)}>
                        <Ban size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={Boolean(revoking)}
        title={`Revoke ${revoking?.certId || ""}`}
        onClose={() => !busy && setRevoking(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" icon={Ban} loading={busy} onClick={revoke} disabled={reason === "Other" && !customReason.trim()}>
              Revoke on-chain
            </Button>
          </>
        }
      >
        <div className="stack">
          <Alert tone="warning">
            Revocation is recorded permanently on the blockchain and cannot be undone. Verifiers will see this
            certificate as <strong>Revoked</strong>.
          </Alert>
          <Field label="Reason (public, stored on-chain)">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {[...REASONS, "Other"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          {reason === "Other" && (
            <Field label="Describe the reason">
              <input value={customReason} onChange={(e) => setCustomReason(e.target.value)} maxLength={140} />
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
