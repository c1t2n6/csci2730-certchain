require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // `npx hardhat node` exposes this chain on http://127.0.0.1:8545
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    // Optional public testnet deployment (fill in blockchain/.env)
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 11155111 } }
      : {}),
  },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "USD" },
};
