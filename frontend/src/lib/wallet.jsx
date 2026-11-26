/**
 * MetaMask wallet context: connection, network switching, on-chain role detection
 * and (lazy) wallet sign-in to the records service.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { CHAIN_ID, NETWORK_NAME, RPC_URL, readContract, describeError } from "./chain";
import { api, walletSession } from "./api";

const WalletContext = createContext(null);

const hexChainId = `0x${CHAIN_ID.toString(16)}`;

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [roles, setRoles] = useState({ loading: false, isAdmin: false, isIssuer: false, institution: null });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const hasMetaMask = typeof window !== "undefined" && Boolean(window.ethereum);

  // ---- roles are read from the contract (source of truth) ----------------
  const loadRoles = useCallback(async (addr) => {
    if (!addr || !readContract) {
      setRoles({ loading: false, isAdmin: false, isIssuer: false, institution: null });
      return;
    }
    setRoles((r) => ({ ...r, loading: true }));
    try {
      const [adminRole, issuerRole] = await Promise.all([readContract.DEFAULT_ADMIN_ROLE(), readContract.ISSUER_ROLE()]);
      const [isAdmin, isIssuer, inst] = await Promise.all([
        readContract.hasRole(adminRole, addr),
        readContract.hasRole(issuerRole, addr),
        readContract.getInstitution(addr),
      ]);
      setRoles({
        loading: false,
        isAdmin,
        isIssuer: isIssuer && inst.active,
        institution: inst.registeredAt > 0n ? { name: inst.name, active: inst.active } : null,
      });
    } catch (err) {
      setRoles({ loading: false, isAdmin: false, isIssuer: false, institution: null });
      setError(describeError(err));
    }
  }, []);

  // ---- restore an existing connection & subscribe to wallet events -------
  useEffect(() => {
    if (!hasMetaMask) return undefined;
    const eth = window.ethereum;
    eth.request({ method: "eth_accounts" }).then((accs) => setAccount(accs[0] ? ethers.getAddress(accs[0]) : null));
    eth.request({ method: "eth_chainId" }).then((id) => setChainId(Number(id)));

    const onAccounts = (accs) => setAccount(accs[0] ? ethers.getAddress(accs[0]) : null);
    const onChain = (id) => setChainId(Number(id));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [hasMetaMask]);

  useEffect(() => {
    loadRoles(account);
  }, [account, loadRoles]);

  // ---- actions ------------------------------------------------------------
  const switchNetwork = useCallback(async () => {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
    } catch (err) {
      if (err.code === 4902 || err?.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexChainId,
              chainName: NETWORK_NAME,
              rpcUrls: [RPC_URL],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (!hasMetaMask) {
      setError("MetaMask is not installed.");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(ethers.getAddress(accs[0]));
      const current = Number(await window.ethereum.request({ method: "eth_chainId" }));
      if (current !== CHAIN_ID) await switchNetwork();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setConnecting(false);
    }
  }, [hasMetaMask, switchNetwork]);

  const disconnect = useCallback(() => {
    setAccount(null);
    walletSession.clear();
  }, []);

  /** Returns a signer, making sure the wallet is on the right network first. */
  const getSigner = useCallback(async () => {
    if (!hasMetaMask) throw new Error("MetaMask is not installed.");
    const current = Number(await window.ethereum.request({ method: "eth_chainId" }));
    if (current !== CHAIN_ID) await switchNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  }, [hasMetaMask, switchNetwork]);

  /**
   * Returns a backend token for this wallet, asking MetaMask to sign a one-time
   * challenge if needed (no gas, no transaction).
   */
  const getApiToken = useCallback(async () => {
    const existing = walletSession.get(account);
    if (existing) return existing.token;
    const { message } = await api.walletChallenge(account);
    const signer = await getSigner();
    const signature = await signer.signMessage(message);
    const session = await api.walletVerify(account, signature);
    walletSession.set(session);
    return session.token;
  }, [account, getSigner]);

  const value = useMemo(
    () => ({
      account,
      chainId,
      wrongNetwork: Boolean(account && chainId && chainId !== CHAIN_ID),
      hasMetaMask,
      connecting,
      error,
      setError,
      roles,
      refreshRoles: () => loadRoles(account),
      connect,
      disconnect,
      switchNetwork,
      getSigner,
      getApiToken,
    }),
    [account, chainId, hasMetaMask, connecting, error, roles, loadRoles, connect, disconnect, switchNetwork, getSigner, getApiToken]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);
