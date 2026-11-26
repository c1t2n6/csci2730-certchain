const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Mirrors the enum in the contract
const Result = { NotFound: 0n, Authentic: 1n, Invalid: 2n, Revoked: 3n };

const sha = (text) => ethers.sha256(ethers.toUtf8Bytes(text)); // stands in for a PDF hash
const studentHash = (id) => ethers.keccak256(ethers.toUtf8Bytes(id.trim().toUpperCase()));
const DEGREE = "Bachelor of Science in Computer Science";

describe("CertificateRegistry", function () {
  async function deployFixture() {
    const [admin, uniA, uniB, outsider, verifier] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy();
    await registry.addInstitution(uniA.address, "University A");
    await registry.addInstitution(uniB.address, "University B");
    return { registry, admin, uniA, uniB, outsider, verifier };
  }

  async function issuedFixture() {
    const ctx = await deployFixture();
    await ctx.registry
      .connect(ctx.uniA)
      .issueCertificate("CUHK-2026-0001", sha("pdf-1"), studentHash("1155000001"), DEGREE);
    return ctx;
  }

  // -------------------------------------------------------------------------
  describe("Institutions & access control", function () {
    it("grants the deployer the admin role", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    });

    it("registers institutions with ISSUER_ROLE", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      expect(await registry.hasRole(await registry.ISSUER_ROLE(), uniA.address)).to.equal(true);
      const inst = await registry.getInstitution(uniA.address);
      expect(inst.name).to.equal("University A");
      expect(inst.active).to.equal(true);
      const [accounts] = await registry.getInstitutions();
      expect(accounts.length).to.equal(2);
    });

    it("only the admin can add institutions", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).addInstitution(outsider.address, "Fake U"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects issuance from a wallet without ISSUER_ROLE", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(
        registry.connect(outsider).issueCertificate("X-1", sha("x"), studentHash("1"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects issuer role granted directly without institution registration", async function () {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await registry.connect(admin).grantRole(await registry.ISSUER_ROLE(), outsider.address);
      await expect(
        registry.connect(outsider).issueCertificate("X-1", sha("x"), studentHash("1"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "InstitutionInactive");
    });

    it("deactivated institutions cannot issue, but old certificates stay valid", async function () {
      const { registry, uniA } = await loadFixture(issuedFixture);
      await expect(registry.deactivateInstitution(uniA.address)).to.emit(registry, "InstitutionDeactivated");
      await expect(
        registry.connect(uniA).issueCertificate("CUHK-2026-0002", sha("pdf-2"), studentHash("2"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      expect(await registry.verifyCertificate("CUHK-2026-0001", sha("pdf-1"))).to.equal(Result.Authentic);
    });
  });

  // -------------------------------------------------------------------------
  describe("Issuance", function () {
    it("stores the certificate and emits CertificateIssued", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes("CUHK-2026-0001"));
      await expect(
        registry.connect(uniA).issueCertificate("CUHK-2026-0001", sha("pdf-1"), studentHash("1155000001"), DEGREE)
      )
        .to.emit(registry, "CertificateIssued")
        .withArgs(key, "CUHK-2026-0001", sha("pdf-1"), studentHash("1155000001"), uniA.address, (t) => t > 0n);

      const c = await registry.getCertificate("CUHK-2026-0001");
      expect(c.certHash).to.equal(sha("pdf-1"));
      expect(c.issuer).to.equal(uniA.address);
      expect(c.degree).to.equal(DEGREE);
      expect(c.revoked).to.equal(false);
      expect(await registry.certificateExists("CUHK-2026-0001")).to.equal(true);
      expect(await registry.totalCertificates()).to.equal(1n);
      expect((await registry.getInstitution(uniA.address)).certificatesIssued).to.equal(1n);
    });

    it("prevents duplicate certificate IDs", async function () {
      const { registry, uniA, uniB } = await loadFixture(issuedFixture);
      await expect(
        registry.connect(uniB).issueCertificate("CUHK-2026-0001", sha("other"), studentHash("9"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
      await expect(
        registry.connect(uniA).issueCertificate("CUHK-2026-0001", sha("other"), studentHash("9"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
    });

    it("prevents registering the same document hash twice", async function () {
      const { registry, uniA } = await loadFixture(issuedFixture);
      await expect(
        registry.connect(uniA).issueCertificate("CUHK-2026-0099", sha("pdf-1"), studentHash("9"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "HashAlreadyRegistered");
    });

    it("rejects empty values", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      await expect(
        registry.connect(uniA).issueCertificate("", sha("a"), studentHash("1"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "EmptyValue");
      await expect(
        registry.connect(uniA).issueCertificate("A-1", ethers.ZeroHash, studentHash("1"), DEGREE)
      ).to.be.revertedWithCustomError(registry, "EmptyValue");
      await expect(
        registry.connect(uniA).issueCertificate("A-1", sha("a"), studentHash("1"), "")
      ).to.be.revertedWithCustomError(registry, "EmptyValue");
    });

    it("issues a batch atomically", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      const ids = ["B-1", "B-2", "B-3"];
      await registry
        .connect(uniA)
        .issueCertificatesBatch(ids, ids.map(sha), ids.map((_, i) => studentHash(`S${i}`)), ids.map(() => DEGREE));
      expect(await registry.totalCertificates()).to.equal(3n);
      expect((await registry.getCertificatesByIssuer(uniA.address)).length).to.equal(3);

      // A batch containing one duplicate reverts entirely.
      await expect(
        registry
          .connect(uniA)
          .issueCertificatesBatch(["B-4", "B-1"], [sha("B-4"), sha("new")], [studentHash("x"), studentHash("y")], [DEGREE, DEGREE])
      ).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
      expect(await registry.certificateExists("B-4")).to.equal(false);
    });

    it("validates batch sizes", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      await expect(registry.connect(uniA).issueCertificatesBatch([], [], [], []))
        .to.be.revertedWithCustomError(registry, "BatchSizeInvalid");
      await expect(registry.connect(uniA).issueCertificatesBatch(["a"], [], [studentHash("1")], [DEGREE]))
        .to.be.revertedWithCustomError(registry, "BatchLengthMismatch");
    });
  });

  // -------------------------------------------------------------------------
  describe("Verification", function () {
    it("returns Authentic for the original file", async function () {
      const { registry } = await loadFixture(issuedFixture);
      expect(await registry.verifyCertificate("CUHK-2026-0001", sha("pdf-1"))).to.equal(Result.Authentic);
    });

    it("returns Invalid for a modified file", async function () {
      const { registry } = await loadFixture(issuedFixture);
      expect(await registry.verifyCertificate("CUHK-2026-0001", sha("pdf-1-edited"))).to.equal(Result.Invalid);
    });

    it("returns NotFound for an unknown ID", async function () {
      const { registry } = await loadFixture(issuedFixture);
      expect(await registry.verifyCertificate("NOPE", sha("pdf-1"))).to.equal(Result.NotFound);
    });

    it("can look a certificate up by hash only", async function () {
      const { registry } = await loadFixture(issuedFixture);
      const [result, certId] = await registry.verifyByHash(sha("pdf-1"));
      expect(result).to.equal(Result.Authentic);
      expect(certId).to.equal("CUHK-2026-0001");
      const [missing] = await registry.verifyByHash(sha("unknown"));
      expect(missing).to.equal(Result.NotFound);
    });

    it("lists certificates by student", async function () {
      const { registry, uniB } = await loadFixture(issuedFixture);
      await registry.connect(uniB).issueCertificate("HKU-1", sha("pdf-b"), studentHash("1155000001"), "MSc");
      const list = await registry.getCertificatesByStudent(studentHash(" 1155000001 "));
      expect(list.map((c) => c.certId)).to.deep.equal(["CUHK-2026-0001", "HKU-1"]);
    });

    it("records verifications on-chain", async function () {
      const { registry, verifier } = await loadFixture(issuedFixture);
      const key = ethers.keccak256(ethers.toUtf8Bytes("CUHK-2026-0001"));
      await expect(registry.connect(verifier).recordVerification("CUHK-2026-0001", sha("pdf-1")))
        .to.emit(registry, "CertificateVerified")
        .withArgs(key, "CUHK-2026-0001", verifier.address, Result.Authentic, (t) => t > 0n);
      await registry.connect(verifier).recordVerification("CUHK-2026-0001", sha("tampered"));
      expect((await registry.getCertificate("CUHK-2026-0001")).verificationCount).to.equal(2n);
    });

    it("paginates the full certificate list", async function () {
      const { registry, uniA } = await loadFixture(deployFixture);
      const ids = ["P-1", "P-2", "P-3", "P-4", "P-5"];
      await registry
        .connect(uniA)
        .issueCertificatesBatch(ids, ids.map(sha), ids.map(() => studentHash("s")), ids.map(() => DEGREE));
      expect((await registry.getCertificates(0, 2)).map((c) => c.certId)).to.deep.equal(["P-1", "P-2"]);
      expect((await registry.getCertificates(4, 10)).map((c) => c.certId)).to.deep.equal(["P-5"]);
      expect((await registry.getCertificates(10, 10)).length).to.equal(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("Revocation", function () {
    it("lets the issuer revoke and verification reports Revoked", async function () {
      const { registry, uniA } = await loadFixture(issuedFixture);
      await expect(registry.connect(uniA).revokeCertificate("CUHK-2026-0001", "Issued in error"))
        .to.emit(registry, "CertificateRevoked");
      const c = await registry.getCertificate("CUHK-2026-0001");
      expect(c.revoked).to.equal(true);
      expect(c.revokeReason).to.equal("Issued in error");
      expect(await registry.verifyCertificate("CUHK-2026-0001", sha("pdf-1"))).to.equal(Result.Revoked);
    });

    it("blocks other institutions and outsiders from revoking", async function () {
      const { registry, uniB, outsider } = await loadFixture(issuedFixture);
      await expect(registry.connect(uniB).revokeCertificate("CUHK-2026-0001", "x"))
        .to.be.revertedWithCustomError(registry, "NotCertificateIssuer");
      await expect(registry.connect(outsider).revokeCertificate("CUHK-2026-0001", "x"))
        .to.be.revertedWithCustomError(registry, "NotCertificateIssuer");
    });

    it("lets the platform admin revoke any certificate", async function () {
      const { registry, admin } = await loadFixture(issuedFixture);
      await registry.connect(admin).revokeCertificate("CUHK-2026-0001", "Accreditation withdrawn");
      expect((await registry.getCertificate("CUHK-2026-0001")).revoked).to.equal(true);
    });

    it("cannot revoke twice, revoke unknown IDs or revoke without a reason", async function () {
      const { registry, uniA } = await loadFixture(issuedFixture);
      await expect(registry.connect(uniA).revokeCertificate("CUHK-2026-0001", ""))
        .to.be.revertedWithCustomError(registry, "EmptyValue");
      await registry.connect(uniA).revokeCertificate("CUHK-2026-0001", "Error");
      await expect(registry.connect(uniA).revokeCertificate("CUHK-2026-0001", "Again"))
        .to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked");
      await expect(registry.connect(uniA).revokeCertificate("UNKNOWN", "x"))
        .to.be.revertedWithCustomError(registry, "CertificateNotFound");
    });
  });
});
