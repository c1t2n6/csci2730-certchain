/** Small presentational building blocks shared by all pages. */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  HelpCircle,
  Info,
  Loader2,
  ShieldX,
  X,
  XCircle,
} from "lucide-react";
import { shortHex } from "../lib/format";

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" />;
}

export function Button({ variant = "primary", size, loading, icon: Icon, children, className = "", ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Spinner /> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Alert({ tone = "info", title, children, onClose }) {
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} className="alert-icon" aria-hidden="true" />
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {onClose && (
        <button className="icon-btn" onClick={onClose} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

const STATUS = {
  authentic: { label: "Authentic", Icon: CheckCircle2 },
  valid: { label: "Valid", Icon: CheckCircle2 },
  invalid: { label: "Invalid", Icon: ShieldX },
  revoked: { label: "Revoked", Icon: AlertTriangle },
  notfound: { label: "Not found", Icon: HelpCircle },
  pending: { label: "Pending", Icon: Loader2 },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.notfound;
  return (
    <span className={`badge badge-${status}`}>
      <s.Icon size={13} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button className="icon-btn" onClick={copy} title={label} aria-label={label} type="button">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/** Monospace hex value, shortened, with copy + optional explorer link. */
export function Hex({ value, full = false, href }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span className="hex">
      <code title={value}>{full ? value : shortHex(value, 8, 6)}</code>
      <CopyButton value={value} />
      {href && (
        <a className="icon-btn" href={href} target="_blank" rel="noreferrer" aria-label="Open in explorer">
          <ExternalLink size={14} />
        </a>
      )}
    </span>
  );
}

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function FileDrop({ onFile, file, accept = "application/pdf", label = "Drop a certificate PDF here" }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const handle = (f) => f && onFile(f);
  return (
    <div
      className={`dropzone ${over ? "over" : ""} ${file ? "has-file" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          handle(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <FileUp size={26} aria-hidden="true" />
      {file ? (
        <>
          <strong>{file.name}</strong>
          <span className="muted">{(file.size / 1024).toFixed(1)} KB · click to replace</span>
        </>
      ) : (
        <>
          <strong>{label}</strong>
          <span className="muted">or click to browse · hashed locally, never uploaded</span>
        </>
      )}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, children }) {
  return (
    <div className="empty">
      <Icon size={28} aria-hidden="true" />
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

/** Key/value list used for on-chain records. */
export function DataList({ rows }) {
  return (
    <dl className="datalist">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="datalist-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
