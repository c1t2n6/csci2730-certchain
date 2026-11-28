/**
 * Deploys CertificateRegistry, registers demo institutions and writes the
 * address + ABI to the frontend and backend so both pick it up automatically.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const OUTPUT_FILES = [
  path.join(__dirname, "..", "..", "frontend", "src", "contract", "deployment.json"),
  path.join(__dirname, "..", "..", "backend", "deployment.json"),
];

function parseInstitutionsEnv() {
  const raw = (process.env.INSTITUTIONS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((pair) => {
    const [address, ...name] = pair.split("=");
    return { address: address.trim(), name: name.join("=").trim() };
  });
}

async function main() {
  const { ethers, network } = hre;
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`\nNetwork  : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer : ${deployer.address}`);

  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  const receipt = await deployTx.wait();
  console.log(`Contract : ${address} (block ${receipt.blockNumber})`);

  // ---- Register issuing institutions ------------------------------------
  let institutions = parseInstitutionsEnv();
  if (institutions.length === 0) {
    institutions = [{ address: deployer.address, name: "CertChain Platform Administration" }];
    // On the local Hardhat chain also register a second university (account #1)
    // so the multi-institution features can be demonstrated.
    if (Number(chainId) === 31337 && signers[1]) {
      institutions.push({ address: signers[1].address, name: "Demo Partner University" });
    }
  }
  for (const inst of institutions) {
    const tx = await registry.addInstitution(inst.address, inst.name);
    await tx.wait();
    console.log(`Issuer   : ${inst.name} -> ${inst.address}`);
  }

  // ---- Export deployment info ------------------------------------------
  const artifact = await hre.artifacts.readArtifact("CertificateRegistry");
  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    address,
    deployBlock: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };
  for (const file of OUTPUT_FILES) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
    console.log(`Wrote    : ${path.relative(path.join(__dirname, "..", ".."), file)}`);
  }
  console.log("\nDone. Restart the backend so it loads the new contract address.\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
