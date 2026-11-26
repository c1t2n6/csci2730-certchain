/**
 * Institution console shell: wallet/role gate, navigation tabs and shared data
 * (on-chain certificates + off-chain details) for the sub-pages.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Building2, KeyRound, Wallet } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { api, walletSession } from "../../lib/api";
import { IS_DEPLOYED, NETWORK_NAME, describeError, readContract, toCertificate } from "../../lib/chain";
import { Alert, Button, Hex, Spinner } from "../../components/ui";

const IssuerContext = createContext(null);
export const useIssuer = () => useContext(IssuerContext);

function Gate({ icon: Icon, title, children }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card stack center">
        <span className="card-icon">
          <Icon size={20} />
        </span>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default function IssuerConsole() {
  const wallet = useWallet();
  const { account, roles, wrongNetwork, hasMetaMask } = wallet;

  const [certs, setCerts] = useState({ loading: true, list: [], error: "" });
  const [meta, setMeta] = useState({ loaded: false, loading: false, byId: {}, error: "" });

  const reloadCerts = useCallback(async () => {
    if (!account || !readContract) return;
    setCerts((c) => ({ ...c, loading: true }));
    try {
      let raw;
      if (roles.isAdmin) {
        const total = Number(await readContract.totalCertificates());
        raw = total ? await readContract.getCertificates(0, total) : [];
      } else {
        raw = await readContract.getCertificatesByIssuer(account);
      }
      const list = raw.map(toCertificate).sort((a, b) => b.issuedAt - a.issuedAt);
      setCerts({ loading: false, list, error: "" });
    } catch (err) {
      setCerts({ loading: false, list: [], error: describeError(err) });
    }
  }, [account, roles.isAdmin]);

  /** Loads off-chain details; prompts a (gas-free) wallet signature if not signed in yet. */
  const loadMeta = useCallback(async () => {
    setMeta((m) => ({ ...m, loading: true, error: "" }));
    try {
      const token = await wallet.getApiToken();
      const { certificates } = await api.issuedCertificates(token);
      setMeta({ loaded: true, loading: false, byId: Object.fromEntries(certificates.map((c) => [c.certId, c])), error: "" });
    } catch (err) {
      if (err.status === 401) walletSession.clear();
      setMeta((m) => ({ ...m, loading: false, error: describeError(err) }));
    }
  }, [wallet]);

  useEffect(() => {
    if (roles.isAdmin || roles.isIssuer) reloadCerts();
  }, [reloadCerts, roles.isAdmin, roles.isIssuer]);

  // Silently load details if a valid sign-in session already exists.
  useEffect(() => {
    if ((roles.isAdmin || roles.isIssuer) && walletSession.get(account)) loadMeta();
    else setMeta({ loaded: false, loading: false, byId: {}, error: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, roles.isAdmin, roles.isIssuer]);

  // ---- gates ---------------------------------------------------------------
  if (!IS_DEPLOYED) return <Alert tone="warning">Deploy the smart contract first.</Alert>;

  if (!hasMetaMask || !account) {
    return (
      <Gate icon={Building2} title="Institution console">
        <p className="muted">
          Universities sign every issuance with their wallet. Connect the MetaMask account registered for your
          institution.
        </p>
        <Button icon={Wallet} onClick={wallet.connect} loading={wallet.connecting} disabled={!hasMetaMask}>
          {hasMetaMask ? "Connect MetaMask" : "MetaMask not detected"}
        </Button>
      </Gate>
    );
  }
  if (wrongNetwork) {
    return (
      <Gate icon={Wallet} title="Wrong network">
        <p className="muted">Your wallet is connected to another network. Switch to {NETWORK_NAME} to continue.</p>
        <Button onClick={wallet.switchNetwork}>Switch network</Button>
      </Gate>
    );
  }
  if (roles.loading) {
    return (
      <div className="card placeholder">
        <Spinner size={22} />
        <span className="muted">Checking on-chain permissions…</span>
      </div>
    );
  }
  if (!roles.isAdmin && !roles.isIssuer) {
    return (
      <Gate icon={KeyRound} title="Wallet not authorised">
        <p className="muted">
          <Hex value={account} /> is not a registered issuing institution on the registry contract
          {roles.institution && !roles.institution.active ? " (its institution has been deactivated)" : ""}.
        </p>
        <p className="muted small">
          Ask the platform administrator to register this address, or switch MetaMask to an institution account.
        </p>
      </Gate>
    );
  }

  const tabs = [
    { to: "/issuer", label: "Overview", end: true },
    roles.isIssuer && { to: "/issuer/issue", label: "Issue" },
    roles.isIssuer && { to: "/issuer/batch", label: "Batch issue" },
    { to: "/issuer/certificates", label: "Certificates" },
    roles.isAdmin && { to: "/issuer/institutions", label: "Institutions" },
  ].filter(Boolean);

  return (
    <IssuerContext.Provider value={{ certs, reloadCerts, meta, loadMeta }}>
      <div className="stack-lg">
        <div className="page-head">
          <div>
            <span className="eyebrow">{roles.isAdmin ? "Platform administrator" : "Issuing institution"}</span>
            <h1>{roles.institution?.name || "Registry administration"}</h1>
          </div>
        </div>
        <nav className="subnav">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </IssuerContext.Provider>
  );
}
