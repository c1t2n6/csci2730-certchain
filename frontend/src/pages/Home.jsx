import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, FileSearch, GraduationCap, Fingerprint, Link2, ShieldCheck, QrCode } from "lucide-react";
import { readContract, readProvider, NETWORK_NAME } from "../lib/chain";
import { Stat } from "../components/ui";

function useRegistryStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!readContract) return;
    Promise.all([readContract.totalCertificates(), readContract.getInstitutions(), readProvider.getBlockNumber()])
      .then(([total, [, details], block]) =>
        setStats({
          total: Number(total),
          institutions: details.filter((d) => d.active).length,
          block,
        })
      )
      .catch(() => setStats(null));
  }, []);
  return stats;
}

const ROLES = [
  {
    to: "/verify",
    icon: FileSearch,
    title: "Verify a certificate",
    text: "Employers and universities upload a PDF or scan its QR code. No account or wallet needed.",
    cta: "Open verifier",
  },
  {
    to: "/student",
    icon: GraduationCap,
    title: "Student portal",
    text: "View your issued certificates, their live blockchain status, and download the original PDF.",
    cta: "Sign in",
  },
  {
    to: "/issuer",
    icon: Building2,
    title: "Institution console",
    text: "Registered universities issue, batch-issue and revoke certificates with their MetaMask wallet.",
    cta: "Open console",
  },
];

const STEPS = [
  { icon: Building2, title: "Issue", text: "The university fills in the award details. A PDF with a QR code is generated." },
  { icon: Fingerprint, title: "Fingerprint", text: "The browser computes the SHA-256 hash of the exact PDF bytes." },
  { icon: Link2, title: "Anchor", text: "The hash is written to the Ethereum smart contract in a signed transaction." },
  { icon: ShieldCheck, title: "Verify", text: "Anyone re-hashes a file and compares it with the immutable on-chain record." },
];

export default function Home() {
  const stats = useRegistryStats();
  return (
    <div className="stack-xl">
      <section className="hero">
        <span className="eyebrow">Ethereum · Solidity · SHA-256</span>
        <h1>Academic certificates that verify themselves.</h1>
        <p className="lead">
          CertChain anchors a cryptographic fingerprint of every certificate on the blockchain. Any change to the
          document — a single character — is detected instantly, and nobody has to trust a university database.
        </p>
        <div className="hero-actions">
          <Link to="/verify" className="btn btn-primary">
            <ShieldCheck size={16} /> Verify a certificate
          </Link>
          <Link to="/issuer" className="btn btn-secondary">
            Issue certificates <ArrowRight size={16} />
          </Link>
        </div>
        {stats && (
          <div className="stats-row">
            <Stat label="Certificates on-chain" value={stats.total} />
            <Stat label="Issuing institutions" value={stats.institutions} />
            <Stat label="Latest block" value={`#${stats.block}`} hint={NETWORK_NAME} />
          </div>
        )}
      </section>

      <section className="grid-3">
        {ROLES.map(({ to, icon: Icon, title, text, cta }) => (
          <Link key={to} to={to} className="card card-link">
            <span className="card-icon">
              <Icon size={20} />
            </span>
            <h3>{title}</h3>
            <p className="muted">{text}</p>
            <span className="card-cta">
              {cta} <ArrowRight size={14} />
            </span>
          </Link>
        ))}
      </section>

      <section className="stack">
        <h2 className="section-title">How it works</h2>
        <div className="steps">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="step">
              <span className="step-num">{i + 1}</span>
              <Icon size={18} className="step-icon" />
              <strong>{title}</strong>
              <p className="muted">{text}</p>
            </div>
          ))}
        </div>
        <div className="card note">
          <QrCode size={18} />
          <p>
            <strong>Privacy by design.</strong> Only the document hash, a hashed student ID and the degree title are
            stored on-chain. Names, e-mails and the PDF itself stay off-chain, so the public ledger never exposes
            personal data.
          </p>
        </div>
      </section>
    </div>
  );
}
