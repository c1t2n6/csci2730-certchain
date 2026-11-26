/**
 * Blockchain helpers: read-only provider, contract instances, hashing and
 * human-readable error decoding.
 */
import { ethers } from "ethers";
import deployment from "../contract/deployment.json";

// Defaults follow the page's host name, so opening the app from a phone via the
// laptop's LAN IP (e.g. after scanning a QR code) still reaches the local chain.
export const RPC_URL = import.meta.env.VITE_RPC_URL || `http://${window.location.hostname}:8545`;
export const CHAIN_ID = deployment.chainId;
export const CONTRACT_ADDRESS = deployment.address;
export const DEPLOY_BLOCK = deployment.deployBlock || 0;
export const ABI = deployment.abi;
export const IS_DEPLOYED = Boolean(deployment.address && deployment.abi?.length);

export const NETWORK_NAMES = { 31337: "Hardhat Local", 11155111: "Sepolia Testnet", 1: "Ethereum Mainnet" };
export const NETWORK_NAME = NETWORK_NAMES[CHAIN_ID] || `Chain ${CHAIN_ID}`;

/** Mirrors `enum VerificationResult` in the contract. */
export const RESULT = ["notfound", "authentic", "invalid", "revoked"];

// ---------------------------------------------------------------------------
// Contract instances
// ---------------------------------------------------------------------------

export const readProvider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });

export const readContract = IS_DEPLOYED ? new ethers.Contract(CONTRACT_ADDRESS, ABI, readProvider) : null;

export const writeContract = (signer) => new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 of raw bytes, as 0x-prefixed hex (matches bytes32 certHash). */
export const sha256 = (bytes) => ethers.sha256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

export const normaliseStudentId = (id) => String(id || "").trim().toUpperCase();

/** keccak256 of the normalised student ID - the only student identifier stored on-chain. */
export const studentIdHash = (id) => ethers.keccak256(ethers.toUtf8Bytes(normaliseStudentId(id)));

export const certKey = (certId) => ethers.keccak256(ethers.toUtf8Bytes(certId));

// ---------------------------------------------------------------------------
// Formatting / mapping
// ---------------------------------------------------------------------------

/** Converts an ethers Result (Certificate struct) into a plain object. */
export function toCertificate(c) {
  return {
    certId: c.certId,
    certHash: c.certHash,
    studentIdHash: c.studentIdHash,
    degree: c.degree,
    issuer: c.issuer,
    issuedAt: Number(c.issuedAt),
    revokedAt: Number(c.revokedAt),
    revoked: c.revoked,
    revokeReason: c.revokeReason,
    verificationCount: Number(c.verificationCount),
  };
}

export const explorerTxUrl = (hash) => (CHAIN_ID === 11155111 ? `https://sepolia.etherscan.io/tx/${hash}` : null);
export const explorerAddressUrl = (addr) =>
  CHAIN_ID === 11155111 ? `https://sepolia.etherscan.io/address/${addr}` : null;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const CUSTOM_ERRORS = {
  CertificateAlreadyExists: "A certificate with this ID already exists on the blockchain.",
  HashAlreadyRegistered: "This exact document has already been registered.",
  CertificateNotFound: "Certificate not found on the blockchain.",
  CertificateAlreadyRevoked: "This certificate has already been revoked.",
  NotCertificateIssuer: "Only the issuing institution can revoke this certificate.",
  InstitutionInactive: "Your institution is not active on the registry.",
  InstitutionNotFound: "Institution not found.",
  AccessControlUnauthorizedAccount: "This wallet is not authorised for this action.",
  BatchSizeInvalid: "A batch must contain between 1 and 50 certificates.",
  BatchLengthMismatch: "Batch data is inconsistent.",
  EmptyValue: "Required fields are missing.",
  ZeroAddress: "Invalid wallet address.",
};

const iface = IS_DEPLOYED ? new ethers.Interface(ABI) : null;

/** Turns MetaMask / ethers / contract errors into a short readable sentence. */
export function describeError(err) {
  if (!err) return "Unknown error";
  if (err.code === "ACTION_REJECTED" || err.info?.error?.code === 4001 || err.code === 4001) {
    return "Request rejected in wallet.";
  }
  let name = err.revert?.name;
  const data = err.data || err.info?.error?.data?.data || err.info?.error?.data || err.error?.data;
  if (!name && iface && typeof data === "string" && data.startsWith("0x")) {
    try {
      name = iface.parseError(data)?.name;
    } catch {
      /* not a known custom error */
    }
  }
  if (name && CUSTOM_ERRORS[name]) return CUSTOM_ERRORS[name];
  const msg = err.shortMessage || err.reason || err.message || String(err);
  if (/nonce/i.test(msg)) {
    return "Nonce mismatch - if you restarted the local chain, clear MetaMask activity (Settings › Advanced › Clear activity tab data).";
  }
  if (/failed to fetch|ECONNREFUSED|could not detect network|network error/i.test(msg)) {
    return "Cannot reach the blockchain node. Is the local chain running?";
  }
  return msg.length > 180 ? `${msg.slice(0, 180)}…` : msg;
}
