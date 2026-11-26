/** Platform admin: register and deactivate issuing institutions. */
import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { Building2, Plus, PowerOff } from "lucide-react";
import { useWallet } from "../../lib/wallet";
import { describeError, readContract, writeContract } from "../../lib/chain";
import { formatTimestamp } from "../../lib/format";
import { Alert, Button, EmptyState, Field, Hex, Spinner } from "../../components/ui";

export default function Institutions() {
  const wallet = useWallet();
  const [list, setList] = useState({ loading: true, items: [] });
  const [form, setForm] = useState({ address: "", name: "" });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [accounts, details] = await readContract.getInstitutions();
    setList({
      loading: false,
      items: accounts.map((a, i) => ({
        address: a,
        name: details[i].name,
        active: details[i].active,
        registeredAt: Number(details[i].registeredAt),
        issued: Number(details[i].certificatesIssued),
      })),
    });
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(describeError(err));
      setList({ loading: false, items: [] });
    });
  }, [load]);

  const run = async (key, fn, success) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const tx = await fn(writeContract(await wallet.getSigner()));
      await tx.wait();
      setNotice(success);
      await load();
      wallet.refreshRoles();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!ethers.isAddress(form.address)) return setError("Enter a valid wallet address (0x…).");
    if (form.name.trim().length < 3) return setError("Enter the institution name.");
    run("add", (c) => c.addInstitution(ethers.getAddress(form.address), form.name.trim()), `${form.name.trim()} registered as an issuer.`).then(
      (ok) => ok && setForm({ address: "", name: "" })
    );
  };

  return (
    <div className="grid-2 align-start">
      <div className="card table-card">
        {list.loading ? (
          <div className="placeholder">
            <Spinner />
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState icon={Building2} title="No institutions registered" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Institution</th>
                <th>Issued</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((i) => (
                <tr key={i.address}>
                  <td>
                    <strong>{i.name}</strong>
                    <div className="small">
                      <Hex value={i.address} />
                    </div>
                    <div className="muted small">since {formatTimestamp(i.registeredAt)}</div>
                  </td>
                  <td>{i.issued}</td>
                  <td>
                    <span className={`badge ${i.active ? "badge-valid" : "badge-notfound"}`}>{i.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="right">
                    {i.active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={PowerOff}
                        loading={busy === i.address}
                        onClick={() => run(i.address, (c) => c.deactivateInstitution(i.address), `${i.name} deactivated.`)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === i.address}
                        onClick={() => run(i.address, (c) => c.addInstitution(i.address, i.name), `${i.name} re-activated.`)}
                      >
                        Re-activate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="card stack" onSubmit={add}>
        <h3>Register an institution</h3>
        <p className="muted small">
          Grants <code>ISSUER_ROLE</code> to the wallet. Deactivating stops new issuance; certificates already issued
          stay verifiable.
        </p>
        <Field label="Wallet address" required>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x…" spellCheck={false} />
        </Field>
        <Field label="Institution name" required>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="The University of Hong Kong" />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Button type="submit" icon={Plus} loading={busy === "add"}>
          Register institution
        </Button>
      </form>
    </div>
  );
}
