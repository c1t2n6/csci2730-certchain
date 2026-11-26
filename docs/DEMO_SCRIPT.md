# Presentation video script (target ≈ 8 minutes)

Requirements from the guide: 5–10 min, ≥1024×768, .mp4, your own voice, **your face visible** (use OBS or Zoom
recording with a webcam overlay). Prepare before recording: chain running, contract freshly deployed, backend +
frontend running, MetaMask with accounts #0, #1, #2 imported, `docs/sample-batch.csv` ready, MetaMask activity
cleared.

| Time | Speaker | Screen | What to say (key points) |
| --- | --- | --- | --- |
| 0:00–0:40 | Member 1 | Face + Home page | Introduce team & title. Problem: fake degrees, slow manual verification, reliance on the university database. Goal: anyone can verify instantly and trustlessly. |
| 0:40–1:40 | Member 1 | README architecture diagram | Three parts: smart contract, React DApp + MetaMask, off-chain records service. What is on-chain (hash, hashed student ID, degree, issuer) vs off-chain (name, e-mail, PDF) and why (privacy, cost). |
| 1:40–2:40 | Member 2 | `CertificateRegistry.sol` | Roles with OpenZeppelin AccessControl; struct & mappings; `issueCertificate` with duplicate checks; `verifyCertificate` returning 4 outcomes; events; custom errors. |
| 2:40–3:50 | Member 2 | Institution console → Issue | Connect account #0 (CUHK). Fill form, preview PDF. Click *Issue*: sign login message (no gas — ECDSA signature), confirm transaction. Show the progress steps, tx hash, block, gas used. Download PDF. |
| 3:50–4:30 | Member 1 | Student portal | Register with the same student ID / e-mail. Certificate appears with *Valid* status. Download, show QR modal and share link. |
| 4:30–5:30 | Member 1 | Verify page | Upload original → **Authentic**, explain hash comparison, proof of issuance, history. Run `npm run tamper …` live, show the tampered PDF looks identical, upload → **Invalid**. Upload a random PDF → **Not found**. |
| 5:30–6:10 | Member 2 | Certificates tab | Revoke with a reason → verify again → **Revoked** with reason. Optionally scan QR with a phone. Record a verification on-chain with account #2 → timeline updates. |
| 6:10–6:50 | Member 2 | Batch issue + Institutions | Upload CSV → 5 certificates in one transaction, compare gas per certificate. Admin registers a new university; account #1 cannot revoke CUHK's certificate (access control). |
| 6:50–7:20 | Member 1 | Terminal | `npm test` → 23 passing tests. |
| 7:20–8:00 | Both | Face | Summary of blockchain concepts used (hashing, signatures, immutability, smart contracts, events). Limitations & future work (salted hashes / ZKP, IPFS, Verifiable Credentials, L2). Thank you. |

Tips: zoom the browser to 110–125 % for readability; hide bookmarks; rehearse once to stay under 10 minutes.
