// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  CertificateRegistry
 * @notice On-chain registry of academic certificates for CertChain.
 *
 *         Only a SHA-256 fingerprint of each certificate PDF and a minimal set of
 *         non-sensitive metadata are stored on-chain. Personal data (student name,
 *         e-mail, the PDF itself) stays off-chain, so the ledger can be public while
 *         still letting anyone prove that a given file is the one the university issued.
 *
 *         Roles
 *         - DEFAULT_ADMIN_ROLE : platform administrator (e.g. an accreditation body).
 *                                Registers / deactivates issuing institutions.
 *         - ISSUER_ROLE        : a registered university wallet. Issues and revokes
 *                                its own certificates.
 *         - anyone             : verifies certificates (free view calls) and may
 *                                optionally record a verification on-chain.
 */
contract CertificateRegistry is AccessControl {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @dev Result returned to verifiers. Order matters (used by the frontend).
    enum VerificationResult {
        NotFound, // 0 - no certificate with this ID / hash on-chain
        Authentic, // 1 - hash matches and certificate is active
        Invalid, // 2 - certificate ID exists but the file hash differs (tampered)
        Revoked // 3 - hash matches but the issuer revoked the certificate
    }

    struct Institution {
        string name;
        bool active;
        uint64 registeredAt;
        uint32 certificatesIssued;
    }

    struct Certificate {
        string certId; // human-readable ID printed on the certificate
        bytes32 certHash; // SHA-256 of the exact PDF bytes
        bytes32 studentIdHash; // keccak256(normalised student ID)
        string degree; // programme title, e.g. "BSc in Computer Science"
        address issuer; // institution wallet that issued it
        uint64 issuedAt;
        uint64 revokedAt;
        bool revoked;
        string revokeReason;
        uint32 verificationCount; // number of on-chain recorded verifications
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// key = keccak256(bytes(certId))
    mapping(bytes32 => Certificate) private _certificates;
    mapping(bytes32 => bytes32) private _keyByHash;
    mapping(bytes32 => bytes32[]) private _keysByStudent;
    mapping(address => bytes32[]) private _keysByIssuer;
    mapping(address => Institution) private _institutions;
    address[] private _institutionList;
    bytes32[] private _allKeys;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event InstitutionAdded(address indexed account, string name, uint256 timestamp);
    event InstitutionDeactivated(address indexed account, uint256 timestamp);

    event CertificateIssued(
        bytes32 indexed key,
        string certId,
        bytes32 certHash,
        bytes32 indexed studentIdHash,
        address indexed issuer,
        uint256 timestamp
    );

    event CertificateRevoked(
        bytes32 indexed key,
        string certId,
        address indexed revokedBy,
        string reason,
        uint256 timestamp
    );

    event CertificateVerified(
        bytes32 indexed key,
        string certId,
        address indexed verifier,
        VerificationResult result,
        uint256 timestamp
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error EmptyValue();
    error InstitutionNotFound(address account);
    error InstitutionInactive(address account);
    error CertificateAlreadyExists(string certId);
    error HashAlreadyRegistered(bytes32 certHash);
    error CertificateNotFound(string certId);
    error CertificateAlreadyRevoked(string certId);
    error NotCertificateIssuer(string certId, address caller);
    error BatchSizeInvalid(uint256 size);
    error BatchLengthMismatch();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @dev Caller must hold ISSUER_ROLE *and* be a registered, active institution.
    modifier onlyActiveIssuer() {
        _checkRole(ISSUER_ROLE);
        if (!_institutions[msg.sender].active) revert InstitutionInactive(msg.sender);
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // =====================================================================
    // Institution management (platform admin)
    // =====================================================================

    /// @notice Register (or re-activate / rename) an issuing institution.
    function addInstitution(address account, string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyValue();

        Institution storage inst = _institutions[account];
        if (inst.registeredAt == 0) {
            inst.registeredAt = uint64(block.timestamp);
            _institutionList.push(account);
        }
        inst.name = name;
        inst.active = true;
        _grantRole(ISSUER_ROLE, account);

        emit InstitutionAdded(account, name, block.timestamp);
    }

    /// @notice Stop an institution from issuing new certificates.
    ///         Certificates it already issued remain verifiable.
    function deactivateInstitution(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Institution storage inst = _institutions[account];
        if (inst.registeredAt == 0) revert InstitutionNotFound(account);
        inst.active = false;
        _revokeRole(ISSUER_ROLE, account);

        emit InstitutionDeactivated(account, block.timestamp);
    }

    // =====================================================================
    // Issuance & revocation (institutions)
    // =====================================================================

    /// @notice Issue a single certificate.
    /// @param certId        Unique human-readable certificate ID (printed on the PDF).
    /// @param certHash      SHA-256 hash of the final PDF bytes.
    /// @param studentIdHash keccak256 of the normalised student ID.
    /// @param degree        Programme title (non-sensitive).
    function issueCertificate(
        string calldata certId,
        bytes32 certHash,
        bytes32 studentIdHash,
        string calldata degree
    ) external onlyActiveIssuer returns (bytes32 key) {
        key = _issue(certId, certHash, studentIdHash, degree);
    }

    /// @notice Issue up to MAX_BATCH_SIZE certificates in one transaction.
    ///         Atomic: if any entry is invalid (e.g. duplicate ID) the whole batch reverts.
    function issueCertificatesBatch(
        string[] calldata certIds,
        bytes32[] calldata certHashes,
        bytes32[] calldata studentIdHashes,
        string[] calldata degrees
    ) external onlyActiveIssuer {
        uint256 n = certIds.length;
        if (n == 0 || n > MAX_BATCH_SIZE) revert BatchSizeInvalid(n);
        if (certHashes.length != n || studentIdHashes.length != n || degrees.length != n) {
            revert BatchLengthMismatch();
        }
        for (uint256 i = 0; i < n; i++) {
            _issue(certIds[i], certHashes[i], studentIdHashes[i], degrees[i]);
        }
    }

    /// @notice Revoke a certificate. Only its issuer or the platform admin may revoke.
    function revokeCertificate(string calldata certId, string calldata reason) external {
        bytes32 key = keccak256(bytes(certId));
        Certificate storage c = _certificates[key];
        if (c.issuedAt == 0) revert CertificateNotFound(certId);
        if (c.issuer != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotCertificateIssuer(certId, msg.sender);
        }
        if (c.revoked) revert CertificateAlreadyRevoked(certId);
        if (bytes(reason).length == 0) revert EmptyValue();

        c.revoked = true;
        c.revokedAt = uint64(block.timestamp);
        c.revokeReason = reason;

        emit CertificateRevoked(key, certId, msg.sender, reason, block.timestamp);
    }

    // =====================================================================
    // Verification (anyone)
    // =====================================================================

    /// @notice Verify a file hash against the record stored for `certId`. Free (view).
    function verifyCertificate(string calldata certId, bytes32 certHash) public view returns (VerificationResult) {
        Certificate storage c = _certificates[keccak256(bytes(certId))];
        if (c.issuedAt == 0) return VerificationResult.NotFound;
        if (c.certHash != certHash) return VerificationResult.Invalid;
        if (c.revoked) return VerificationResult.Revoked;
        return VerificationResult.Authentic;
    }

    /// @notice Look a certificate up purely by its file hash (when the ID is unknown).
    function verifyByHash(bytes32 certHash) external view returns (VerificationResult result, string memory certId) {
        bytes32 key = _keyByHash[certHash];
        if (key == bytes32(0)) return (VerificationResult.NotFound, "");
        Certificate storage c = _certificates[key];
        result = c.revoked ? VerificationResult.Revoked : VerificationResult.Authentic;
        certId = c.certId;
    }

    /// @notice Verify and leave a permanent, timestamped audit record on-chain.
    function recordVerification(string calldata certId, bytes32 certHash) external returns (VerificationResult result) {
        result = verifyCertificate(certId, certHash);
        bytes32 key = keccak256(bytes(certId));
        if (result != VerificationResult.NotFound) {
            _certificates[key].verificationCount += 1;
        }
        emit CertificateVerified(key, certId, msg.sender, result, block.timestamp);
    }

    // =====================================================================
    // Read helpers
    // =====================================================================

    function certificateExists(string calldata certId) external view returns (bool) {
        return _certificates[keccak256(bytes(certId))].issuedAt != 0;
    }

    /// @notice Returns an empty struct (issuedAt == 0) when the ID is unknown.
    function getCertificate(string calldata certId) external view returns (Certificate memory) {
        return _certificates[keccak256(bytes(certId))];
    }

    function getCertificateByKey(bytes32 key) external view returns (Certificate memory) {
        return _certificates[key];
    }

    function getCertificatesByStudent(bytes32 studentIdHash) external view returns (Certificate[] memory) {
        return _collect(_keysByStudent[studentIdHash]);
    }

    function getCertificatesByIssuer(address issuer) external view returns (Certificate[] memory) {
        return _collect(_keysByIssuer[issuer]);
    }

    function totalCertificates() external view returns (uint256) {
        return _allKeys.length;
    }

    /// @notice Paginated list of every certificate (newest last).
    function getCertificates(uint256 offset, uint256 limit) external view returns (Certificate[] memory list) {
        uint256 total = _allKeys.length;
        if (offset >= total) return new Certificate[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        list = new Certificate[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            list[i - offset] = _certificates[_allKeys[i]];
        }
    }

    function getInstitution(address account) external view returns (Institution memory) {
        return _institutions[account];
    }

    function getInstitutions() external view returns (address[] memory accounts, Institution[] memory details) {
        uint256 n = _institutionList.length;
        accounts = new address[](n);
        details = new Institution[](n);
        for (uint256 i = 0; i < n; i++) {
            accounts[i] = _institutionList[i];
            details[i] = _institutions[_institutionList[i]];
        }
    }

    // =====================================================================
    // Internal
    // =====================================================================

    function _issue(
        string calldata certId,
        bytes32 certHash,
        bytes32 studentIdHash,
        string calldata degree
    ) internal returns (bytes32 key) {
        if (bytes(certId).length == 0 || bytes(degree).length == 0) revert EmptyValue();
        if (certHash == bytes32(0) || studentIdHash == bytes32(0)) revert EmptyValue();

        key = keccak256(bytes(certId));
        if (_certificates[key].issuedAt != 0) revert CertificateAlreadyExists(certId);
        if (_keyByHash[certHash] != bytes32(0)) revert HashAlreadyRegistered(certHash);

        Certificate storage c = _certificates[key];
        c.certId = certId;
        c.certHash = certHash;
        c.studentIdHash = studentIdHash;
        c.degree = degree;
        c.issuer = msg.sender;
        c.issuedAt = uint64(block.timestamp);

        _keyByHash[certHash] = key;
        _keysByStudent[studentIdHash].push(key);
        _keysByIssuer[msg.sender].push(key);
        _allKeys.push(key);
        _institutions[msg.sender].certificatesIssued += 1;

        emit CertificateIssued(key, certId, certHash, studentIdHash, msg.sender, block.timestamp);
    }

    function _collect(bytes32[] storage keys) private view returns (Certificate[] memory list) {
        list = new Certificate[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            list[i] = _certificates[keys[i]];
        }
    }
}
