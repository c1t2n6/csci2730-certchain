/**
 * Read-only connection to the CertificateRegistry contract.
 * The backend never holds a private key: all writes are signed by users in MetaMask.
 */
import fs from "node:fs";
import { ethers } from "ethers";
import { config, DEPLOYMENT_FILE } from "./config.js";

const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true });

let cached = { mtimeMs: 0, contract: null, deployment: null };

/** Loads deployment.json (re-reads automatically after a re-deploy). */
export function getDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw Object.assign(new Error("Contract not deployed yet - run the deploy script first."), { status: 503 });
  }
  const { mtimeMs } = fs.statSync(DEPLOYMENT_FILE);
  if (mtimeMs !== cached.mtimeMs) {
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
    cached = {
      mtimeMs,
      deployment,
      contract: new ethers.Contract(deployment.address, deployment.abi, provider),
    };
  }
  return cached.deployment;
}

export function getContract() {
  getDeployment();
  return cached.contract;
}

export const studentIdHash = (studentId) =>
  ethers.keccak256(ethers.toUtf8Bytes(String(studentId).trim().toUpperCase()));

export const sha256Hex = (buffer) => ethers.sha256(new Uint8Array(buffer));

/** Returns the on-chain role of an address: "admin", "issuer" or null. */
export async function getWalletRole(address) {
  const contract = getContract();
  const [adminRole, issuerRole] = await Promise.all([contract.DEFAULT_ADMIN_ROLE(), contract.ISSUER_ROLE()]);
  const [isAdmin, isIssuer] = await Promise.all([
    contract.hasRole(adminRole, address),
    contract.hasRole(issuerRole, address),
  ]);
  if (isAdmin) return "admin";
  if (isIssuer) return "issuer";
  return null;
}

export async function chainStatus() {
  const deployment = getDeployment();
  const [network, block] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  return { chainId: Number(network.chainId), blockNumber: block, contract: deployment.address };
}
