/** Thin client for the CertChain records service (backend). */

export const API_URL = (import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000`).replace(/\/$/, "");

const STUDENT_KEY = "certchain.student";
const WALLET_KEY = "certchain.wallet";

// ---- token storage (wrapped: storage can be unavailable in some contexts) --
function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const isExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
};

export const studentSession = {
  get() {
    const s = readJson(STUDENT_KEY);
    return s && !isExpired(s.token) ? s : null;
  },
  set: (s) => writeJson(STUDENT_KEY, s),
  clear: () => writeJson(STUDENT_KEY, null),
};

export const walletSession = {
  get(address) {
    const s = readJson(WALLET_KEY);
    if (!s || !address || s.address.toLowerCase() !== address.toLowerCase() || isExpired(s.token)) return null;
    return s;
  },
  set: (s) => writeJson(WALLET_KEY, s),
  clear: () => writeJson(WALLET_KEY, null),
};

// ---- request helper --------------------------------------------------------
async function request(path, { method = "GET", body, token, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  } catch {
    throw new Error("Cannot reach the CertChain server. Is the backend running?");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* non-JSON error */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

export const api = {
  health: () => request("/api/health"),

  // students
  register: (data) => request("/api/auth/register", { method: "POST", body: data }),
  login: (data) => request("/api/auth/login", { method: "POST", body: data }),
  myCertificates: (token) => request("/api/certificates/mine", { token }),

  // institutions (wallet sign-in)
  walletChallenge: (address) => request(`/api/auth/wallet/challenge?address=${address}`),
  walletVerify: (address, signature) =>
    request("/api/auth/wallet/verify", { method: "POST", body: { address, signature } }),
  issuedCertificates: (token) => request("/api/certificates/issued", { token }),
  uploadCertificates: (token, items, pdfs) => {
    const form = new FormData();
    form.append("meta", JSON.stringify(items));
    pdfs.forEach((bytes, i) =>
      form.append(`file_${i}`, new Blob([bytes], { type: "application/pdf" }), `${items[i].certId}.pdf`)
    );
    return request("/api/certificates", { method: "POST", body: form, token });
  },

  // public
  publicCertificate: (certId) => request(`/api/certificates/${encodeURIComponent(certId)}/public`),

  async downloadFile(certId, token) {
    const res = await request(`/api/certificates/${encodeURIComponent(certId)}/file`, { token, raw: true });
    return new Uint8Array(await res.arrayBuffer());
  },
};
