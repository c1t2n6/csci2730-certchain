import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, Files, Activity } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { DEPLOY_BLOCK, RESULT, readContract } from "../../lib/chain";
import { useIssuer } from "./IssuerConsole";
import { DataList, EmptyState, Hex, Spinner, Stat } from "../../components/ui";
import { Timeline, useInstitutions } from "../../components/CertificateRecord";

/** Recent contract activity relevant to this wallet (all activity for the admin). */
function useActivity(account, isAdmin, refresh) {
  const [state, setState] = useState({ loading: true, events: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = readContract;
      const issuer = isAdmin ? null : account;
      const [issued, revoked] = await Promise.all([
        c.queryFilter(c.filters.CertificateIssued(null, null, issuer), DEPLOY_BLOCK),
        c.queryFilter(c.filters.CertificateRevoked(null, isAdmin ? null : account), DEPLOY_BLOCK),
      ]);
      // Verifications: keep those that concern certificates we can see.
      const verified = await c.queryFilter(c.filters.CertificateVerified(), DEPLOY_BLOCK);
      const mine = new Set(issued.map((e) => e.args.key));
      const map = (type, actor) => (e) => ({
        type,
        txHash: e.transactionHash,
        block: e.blockNumber,
        timestamp: Number(e.args.timestamp),
        actor: e.args[actor],
        reason: type === "revoked" ? e.args.reason : undefined,
        result: type === "verified" ? RESULT[Number(e.args.result)] : undefined,
        certId: e.args.certId,
      });
      const events = [
        ...issued.map(map("issued", "issuer")),
        ...revoked.map(map("revoked", "revokedBy")),
        ...verified.filter((e) => isAdmin || mine.has(e.args.key)).map(map("verified", "verifier")),
      ]
        .sort((a, b) => b.block - a.block)
        .slice(0, 10);
      if (!cancelled) setState({ loading: false, events });
    })().catch(() => !cancelled && setState({ loading: false, events: [] }));
    return () => {
      cancelled = true;
    };
  }, [account, isAdmin, refresh]);
  return state;
}

export default function Overview() {
  const { account, roles } = useWallet();
  const { certs } = useIssuer();
  const institutions = useInstitutions();
  const activity = useActivity(account, roles.isAdmin, certs.list.length);

  const active = certs.list.filter((c) => !c.revoked).length;
  const revoked = certs.list.length - active;
  const verifications = certs.list.reduce((s, c) => s + c.verificationCount, 0);

  return (
    <div className="stack-lg">
      <div className="stats-row">
        <Stat label={roles.isAdmin ? "Certificates (all)" : "Certificates issued"} value={certs.loading ? "…" : certs.list.length} />
        <Stat label="Active" value={certs.loading ? "…" : active} />
        <Stat label="Revoked" value={certs.loading ? "…" : revoked} />
        <Stat label="Verifications logged" value={certs.loading ? "…" : verifications} />
      </div>

      <div className="grid-2">
        <div className="card stack-sm">
          <h3>This wallet</h3>
          <DataList
            rows={[
              ["Address", <Hex key="a" value={account} />],
              ["Institution", roles.institution?.name || "—"],
              ["Status", roles.institution?.active ? "Active issuer" : roles.isAdmin ? "Administrator" : "Inactive"],
              ["Permissions", [roles.isAdmin && "DEFAULT_ADMIN_ROLE", roles.isIssuer && "ISSUER_ROLE"].filter(Boolean).join(", ")],
            ]}
          />
          {roles.isIssuer && (
            <div className="row wrap">
              <Link to="/issuer/issue" className="btn btn-primary btn-sm">
                <FilePlus2 size={16} /> Issue certificate
              </Link>
              <Link to="/issuer/certificates" className="btn btn-secondary btn-sm">
                <Files size={16} /> Manage certificates
              </Link>
            </div>
          )}
        </div>
        <div className="card stack-sm">
          <h3>Recent on-chain activity</h3>
          {activity.loading ? (
            <Spinner />
          ) : activity.events.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet">
              Issued, revoked and verified certificates will show up here.
            </EmptyState>
          ) : (
            <Timeline events={activity.events} institutions={institutions} />
          )}
        </div>
      </div>
    </div>
  );
}
