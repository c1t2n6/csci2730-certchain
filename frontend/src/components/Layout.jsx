import { NavLink, Link, Outlet } from "react-router-dom";
import { Wallet, LogOut, AlertTriangle } from "lucide-react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_ADDRESS, IS_DEPLOYED, NETWORK_NAME, explorerAddressUrl } from "../lib/chain";
import { shortHex } from "../lib/format";
import { Alert, Button, Hex } from "./ui";

function Logo() {
  return (
    <Link to="/" className="brand">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M10 17.5l4 4 8-9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>CertChain</span>
    </Link>
  );
}

export function WalletButton() {
  const { account, connect, disconnect, connecting, wrongNetwork, switchNetwork, hasMetaMask, roles } = useWallet();
  if (!hasMetaMask) {
    return (
      <a className="btn btn-secondary btn-sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install MetaMask
      </a>
    );
  }
  if (!account) {
    return (
      <Button size="sm" variant="secondary" icon={Wallet} onClick={connect} loading={connecting}>
        Connect wallet
      </Button>
    );
  }
  if (wrongNetwork) {
    return (
      <Button size="sm" variant="warning" icon={AlertTriangle} onClick={switchNetwork}>
        Switch to {NETWORK_NAME}
      </Button>
    );
  }
  const role = roles.isAdmin ? "Admin" : roles.isIssuer ? "Issuer" : null;
  return (
    <div className="wallet-pill">
      <span className="dot" aria-hidden="true" />
      <code>{shortHex(account, 4, 4)}</code>
      {role && <span className="role-tag">{role}</span>}
      <button className="icon-btn" onClick={disconnect} title="Disconnect" aria-label="Disconnect wallet">
        <LogOut size={14} />
      </button>
    </div>
  );
}

export default function Layout() {
  const { error, setError } = useWallet();
  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <Logo />
          <nav className="nav">
            <NavLink to="/verify">Verify</NavLink>
            <NavLink to="/student">Student</NavLink>
            <NavLink to="/issuer">Institution</NavLink>
          </nav>
          <div className="topbar-right">
            <span className="network-pill" title="Blockchain network">
              <span className="dot" aria-hidden="true" />
              {NETWORK_NAME}
            </span>
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="container main">
        {!IS_DEPLOYED && (
          <Alert tone="warning" title="Smart contract not deployed">
            Start the local chain and run <code>npm run deploy:local</code> in the <code>blockchain</code> folder, then reload.
          </Alert>
        )}
        {error && (
          <Alert tone="error" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span>CertChain · CSCI2730 Blockchain Project</span>
          {IS_DEPLOYED && (
            <span className="footer-contract">
              Registry contract <Hex value={CONTRACT_ADDRESS} href={explorerAddressUrl(CONTRACT_ADDRESS)} />
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
