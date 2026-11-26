/**
 * Shared pieces that read certificate history from contract events:
 * issuance transaction proof and the verification / revocation timeline.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck2, ShieldAlert, Eye } from "lucide-react";
import { DEPLOY_BLOCK, RESULT, certKey, explorerTxUrl, readContract, readProvider } from "../lib/chain";
import { formatTimestamp, shortHex } from "../lib/format";
import { DataList, Hex, Spinner, StatusBadge } from "./ui";

/** Loads every event that concerns one certificate, oldest first. */
export async function loadCertificateEvents(certId) {
  const key = certKey(certId);
  const c = readContract;
  const [issued, revoked, verified] = await Promise.all([
    c.queryFilter(c.filters.CertificateIssued(key), DEPLOY_BLOCK),
    c.queryFilter(c.filters.CertificateRevoked(key), DEPLOY_BLOCK),
    c.queryFilter(c.filters.CertificateVerified(key), DEPLOY_BLOCK),
  ]);
  const toItem = (type) => (e) => ({
    type,
    txHash: e.transactionHash,
    block: e.blockNumber,
    timestamp: Number(e.args.timestamp),
    actor: type === "issued" ? e.args.issuer : type === "revoked" ? e.args.revokedBy : e.args.verifier,
    reason: type === "revoked" ? e.args.reason : undefined,
    result: type === "verified" ? RESULT[Number(e.args.result)] : undefined,
  });
  return [...issued.map(toItem("issued")), ...revoked.map(toItem("revoked")), ...verified.map(toItem("verified"))].sort(
    (a, b) => a.block - b.block
  );
}

export function useCertificateEvents(certId, refreshKey = 0) {
  const [state, setState] = useState({ loading: true, events: [], error: "" });
  useEffect(() => {
    if (!certId || !readContract) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loadCertificateEvents(certId)
      .then((events) => !cancelled && setState({ loading: false, events, error: "" }))
      .catch((err) => !cancelled && setState({ loading: false, events: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [certId, refreshKey]);
  return state;
}

/** Issuance transaction details: the cryptographic "receipt" of issuance. */
export function TxProof({ txHash }) {
  const [tx, setTx] = useState(null);
  useEffect(() => {
    if (!txHash) return;
    let cancelled = false;
    readProvider.getTransactionReceipt(txHash).then((r) => !cancelled && setTx(r));
    return () => {
      cancelled = true;
    };
  }, [txHash]);
  if (!txHash) return null;
  return (
    <DataList
      rows={[
        ["Transaction", <Hex key="tx" value={txHash} href={explorerTxUrl(txHash)} />],
        ["Block", tx ? `#${tx.blockNumber}` : <Spinner key="s" size={14} />],
        ["Sent from", tx ? <Hex key="f" value={tx.from} /> : "…"],
        ["Gas used", tx ? Number(tx.gasUsed).toLocaleString() : "…"],
        ["Status", tx ? (tx.status === 1 ? "Success" : "Failed") : "…"],
      ]}
    />
  );
}

const ICONS = { issued: FileCheck2, revoked: ShieldAlert, verified: Eye };
const TITLES = { issued: "Issued", revoked: "Revoked", verified: "Verification recorded" };

export function Timeline({ events, institutions = {} }) {
  if (!events.length) return <p className="muted">No events yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e) => {
        const Icon = ICONS[e.type] || CheckCircle2;
        return (
          <li key={`${e.txHash}-${e.type}`} className={`timeline-item t-${e.type}`}>
            <span className="timeline-icon">
              <Icon size={14} aria-hidden="true" />
            </span>
            <div className="timeline-body">
              <div className="timeline-title">
                {TITLES[e.type]}
                {e.certId && <code className="small">{e.certId}</code>}
                {e.result && <StatusBadge status={e.result} />}
              </div>
              <div className="timeline-meta">
                {formatTimestamp(e.timestamp)} · by {institutions[e.actor?.toLowerCase()] || shortHex(e.actor, 4, 4)} · block #
                {e.block}
              </div>
              {e.reason && <div className="timeline-reason">Reason: {e.reason}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Map of lowercase address -> institution name, loaded once from the contract. */
export function useInstitutions() {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!readContract) return;
    readContract
      .getInstitutions()
      .then(([accounts, details]) => {
        const m = {};
        accounts.forEach((a, i) => (m[a.toLowerCase()] = details[i].name));
        setMap(m);
      })
      .catch(() => {});
  }, []);
  return map;
}
