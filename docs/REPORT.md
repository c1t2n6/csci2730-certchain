# CertChain: A Blockchain-Based Academic Certificate Verification System

**CSCI2730 Blockchain Project — Development stream (brief report)**
Beh Jia Xin (1155283623) · Nguyen Le Thanh Nguyen (1155227835)
GitHub: `https://github.com/<your-account>/certchain`

## 1. Problem and objectives

Certificate fraud is common because employers must trust a paper document or contact the issuing university,
which is slow and depends on the university's own database. Our objective is a system in which (i) only
authorised universities can issue certificates, (ii) anyone can verify a certificate instantly and for free, and
(iii) any modification of a certificate is detected, without relying on a single trusted database.

## 2. System architecture

CertChain has three components (see the README diagrams):

- **Smart contract** — `CertificateRegistry.sol` (Solidity 0.8.24) deployed on Ethereum (local Hardhat chain;
  Sepolia supported). It stores, per certificate, the SHA-256 hash of the PDF, `keccak256(studentId)`, the degree
  title, the issuer address and timestamps, and emits events for issuance, revocation and verification.
- **Web application** — React + ethers.js. Universities sign transactions with MetaMask; verifiers and students use
  free read-only calls. PDFs (with a QR code) are generated and hashed in the browser.
- **Records service** — Node.js/Express. Stores personal data and PDF files off-chain, handles student accounts
  (bcrypt + JWT) and wallet sign-in. It is *not trusted*: every upload is re-checked against the contract.

## 3. Key blockchain concepts applied

| Concept (course topic) | How it is used |
| --- | --- |
| Cryptographic hash functions (Lec 3) | SHA-256 fingerprint of the exact PDF bytes; keccak-256 of student IDs and certificate IDs (mapping keys). Avalanche effect → any edit changes the hash. |
| Digital signatures / ECDSA (Lec 3B) | Every issuance/revocation is a signed transaction; institutions log in to the backend by signing a one-time nonce (`personal_sign`), recovered with `ecrecover`-equivalent `verifyMessage`. |
| Immutability & decentralised trust (Lec 1–2) | Records cannot be silently altered; verifiers query the chain directly, not the university. |
| Smart contracts & access control (Lec 6, 9) | OpenZeppelin `AccessControl` roles (admin / issuer), custom errors, modifiers, atomic batch issuance. |
| Ethereum events & DApps (Lec 7–10) | Events form an auditable history (issued → verified → revoked) rendered as a timeline; MetaMask + ethers.js frontend as in Tutorial 13. |

## 4. Implementation highlights

1. **Issuance pipeline:** validate → check duplicate ID on-chain → generate PDF with QR → SHA-256 → transaction →
   wait for confirmation → upload PDF. The transaction hash, block and gas used are shown as proof of issuance.
2. **Four verification outcomes** computed on-chain: *Authentic*, *Invalid* (hash mismatch), *Revoked*, *Not found*.
   The certificate ID is read automatically from the PDF metadata; otherwise the hash alone is looked up.
3. **Duplicate prevention** for both certificate IDs and document hashes; **revocation** with a public reason,
   restricted to the issuer or platform admin.
4. **Multi-university support** with activation/deactivation; deactivated issuers cannot issue but history remains.
5. **Batch issuance** of up to 50 certificates from CSV in one atomic transaction, reducing gas per certificate.
6. **Optional on-chain verification log** giving an auditable verification history per certificate.
7. **Privacy by design:** no names or e-mails on-chain; the backend shows verifiers only a masked student ID.

## 5. Testing and results

23 automated Hardhat/Chai tests cover access control, institution lifecycle, issuance, duplicate prevention, batch
atomicity, all verification outcomes, revocation permissions and verification logging (all passing). End-to-end
scenarios — issue, download, verify, tamper (using `tools/tamper-pdf.mjs`, which edits the PDF while keeping it
readable), revoke, batch-issue and QR verification — are demonstrated in the video. A tampered PDF that looks
identical to the original is correctly reported as *Invalid*.

*(Insert measured gas figures from `REPORT_GAS=true npx hardhat test`, e.g. single issuance vs. per-certificate cost
in a batch.)*

## 6. Limitations and future work

Short student IDs hashed without a salt could be brute-forced; a per-student salt or zero-knowledge proofs would
strengthen privacy. PDFs could be stored encrypted on IPFS instead of a central server, certificates could follow the
W3C Verifiable Credentials standard, and deployment on a Layer-2 network would lower transaction fees.

## 7. How to run

See `README.md`: `npm run setup`, `npm run chain`, `npm run deploy`, `npm run backend`, `npm run frontend`,
then open `http://localhost:5173` with MetaMask connected to the local Hardhat network.

## References

Bashir, Imran. *Mastering Blockchain*. 4th ed. Birmingham: Packt Publishing, 2023.

OpenZeppelin. "Access Control." OpenZeppelin Contracts 5.x Documentation. Accessed November 2026.
https://docs.openzeppelin.com/contracts/5.x/access-control.

Ethereum Foundation. "Solidity Documentation, v0.8.24." Accessed November 2026. https://docs.soliditylang.org.

Grech, Alexander, and Anthony F. Camilleri. *Blockchain in Education*. Luxembourg: Publications Office of the
European Union, 2017.
