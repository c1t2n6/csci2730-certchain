/**
 * Student portal: register / sign in, list certificates with live on-chain
 * status, download the original PDF, share the verification link / QR code.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { Download, ExternalLink, GraduationCap, LogOut, QrCode, UserPlus, LogIn } from "lucide-react";
import { api, studentSession } from "../lib/api";
import { readContract, studentIdHash, toCertificate } from "../lib/chain";
import { downloadPdf, verifyUrl } from "../lib/pdf";
import { formatDate, formatTimestamp } from "../lib/format";
import { Alert, Button, CopyButton, EmptyState, Field, Hex, Modal, Spinner, StatusBadge } from "../components/ui";

// ---------------------------------------------------------------------------
function AuthForm({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ studentId: "", fullName: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const session = mode === "login" ? await api.login(form) : await api.register(form);
      studentSession.set(session);
      onSignedIn(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card stack">
        <div className="stack-sm center">
          <span className="card-icon">
            <GraduationCap size={20} />
          </span>
          <h1>Student portal</h1>
          <p className="muted">Access the certificates your university has issued to you.</p>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Create account
          </button>
        </div>
        <form className="stack" onSubmit={submit}>
          <Field label="Student ID" required>
            <input value={form.studentId} onChange={set("studentId")} placeholder="1155123456" autoComplete="username" required />
          </Field>
          {mode === "register" && (
            <>
              <Field label="Full name" required>
                <input value={form.fullName} onChange={set("fullName")} autoComplete="name" required />
              </Field>
              <Field label="University e-mail" hint="Must match the e-mail your university recorded on the certificate." required>
                <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
              </Field>
            </>
          )}
          <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined} required>
            <input
              type="password"
              value={form.password}
              onChange={set("password")}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={loading} icon={mode === "login" ? LogIn : UserPlus}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function QrModal({ certId, onClose }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (certId) QRCode.toDataURL(verifyUrl(certId), { width: 260, margin: 1 }).then(setSrc);
  }, [certId]);
  return (
    <Modal open={Boolean(certId)} title="Verification QR code" onClose={onClose}>
      <div className="stack center">
        {src ? <img src={src} alt={`QR code for ${certId}`} width={220} height={220} /> : <Spinner />}
        <code className="small">{certId && verifyUrl(certId)}</code>
        <p className="muted small">Anyone who scans this code sees the live blockchain status of your certificate.</p>
      </div>
    </Modal>
  );
}

function Dashboard({ session, onSignOut }) {
  const [state, setState] = useState({ loading: true, items: [], onChainCount: 0, error: "" });
  const [qrFor, setQrFor] = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ certificates }, onChain] = await Promise.all([
          api.myCertificates(session.token),
          readContract ? readContract.getCertificatesByStudent(studentIdHash(session.student.studentId)) : [],
        ]);
        const chainById = new Map(onChain.map((c) => [c.certId, toCertificate(c)]));
        const items = certificates.map((m) => ({ ...m, chain: chainById.get(m.certId) || null }));
        items.sort((a, b) => (b.chain?.issuedAt || 0) - (a.chain?.issuedAt || 0));
        if (!cancelled) setState({ loading: false, items, onChainCount: onChain.length, error: "" });
      } catch (err) {
        if (err.status === 401) onSignOut();
        if (!cancelled) setState({ loading: false, items: [], onChainCount: 0, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, onSignOut]);

  const download = async (certId) => {
    setDownloading(certId);
    try {
      downloadPdf(await api.downloadFile(certId, session.token), `${certId}.pdf`);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Welcome, {session.student.fullName.split(" ")[0]}</h1>
          <p className="muted">
            Student ID <code>{session.student.studentId}</code> · {session.student.email}
          </p>
        </div>
        <Button variant="ghost" icon={LogOut} onClick={onSignOut}>
          Sign out
        </Button>
      </div>

      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.loading ? (
        <div className="card placeholder">
          <Spinner size={22} />
        </div>
      ) : state.items.length === 0 ? (
        <div className="card">
          <EmptyState icon={GraduationCap} title="No certificates yet">
            {state.onChainCount > 0
              ? `${state.onChainCount} record(s) on-chain are linked to your student ID, but the e-mail on file does not match your account.`
              : "When your university issues a certificate to your student ID, it will appear here."}
          </EmptyState>
        </div>
      ) : (
        <div className="cert-list">
          {state.items.map((c) => {
            const status = !c.chain ? "notfound" : c.chain.revoked ? "revoked" : "valid";
            return (
              <article key={c.certId} className="card cert-card">
                <div className="cert-card-main">
                  <div className="row between wrap">
                    <span className="eyebrow">{c.institutionName}</span>
                    <StatusBadge status={status} />
                  </div>
                  <h3>{c.degree}</h3>
                  <p className="muted">
                    {[c.major && `Major in ${c.major}`, c.honours].filter(Boolean).join(" · ") || " "}
                  </p>
                  <div className="cert-meta">
                    <span>
                      <span className="muted small">Certificate ID</span>
                      <code>{c.certId}</code>
                    </span>
                    <span>
                      <span className="muted small">Graduated</span>
                      {formatDate(c.graduationDate)}
                    </span>
                    <span>
                      <span className="muted small">Anchored on-chain</span>
                      {formatTimestamp(c.chain?.issuedAt)}
                    </span>
                    <span>
                      <span className="muted small">Document hash</span>
                      <Hex value={c.certHash} />
                    </span>
                  </div>
                  {c.chain?.revoked && (
                    <Alert tone="warning" title="Revoked by issuer">
                      {c.chain.revokeReason}
                    </Alert>
                  )}
                </div>
                <div className="cert-card-actions">
                  <Button size="sm" icon={Download} loading={downloading === c.certId} onClick={() => download(c.certId)}>
                    Download PDF
                  </Button>
                  <Button size="sm" variant="secondary" icon={QrCode} onClick={() => setQrFor(c.certId)}>
                    QR code
                  </Button>
                  <Link className="btn btn-ghost btn-sm" to={`/verify/${encodeURIComponent(c.certId)}`}>
                    <ExternalLink size={16} /> Verification page
                  </Link>
                  <span className="row small muted">
                    Share link <CopyButton value={verifyUrl(c.certId)} label="Copy verification link" />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <QrModal certId={qrFor} onClose={() => setQrFor(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function Student() {
  const [session, setSession] = useState(() => studentSession.get());
  const signOut = useCallback(() => {
    studentSession.clear();
    setSession(null);
  }, []);
  return session ? <Dashboard session={session} onSignOut={signOut} /> : <AuthForm onSignedIn={setSession} />;
}
