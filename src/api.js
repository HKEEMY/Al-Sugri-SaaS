const TOKEN_KEY = "al-sugri-saas-token";
const ORG_KEY = "al-sugri-saas-org";
const CACHE_PREFIX = "al-sugri-saas-cache:";
const DIRTY_PREFIX = "al-sugri-saas-dirty:";
const VERSION_PREFIX = "al-sugri-saas-ver:";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getSelectedOrgId() {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setSelectedOrgId(orgId) {
  try {
    if (orgId) localStorage.setItem(ORG_KEY, orgId);
    else localStorage.removeItem(ORG_KEY);
  } catch {}
}

export function clearSession() {
  setToken(null);
  setSelectedOrgId(null);
}

function cacheKey(orgId) {
  return CACHE_PREFIX + orgId;
}
function dirtyKey(orgId) {
  return DIRTY_PREFIX + orgId;
}
function versionKey(orgId) {
  return VERSION_PREFIX + orgId;
}

export function loadCachedDB(orgId) {
  if (!orgId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(orgId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function cacheDB(orgId, data) {
  if (!orgId) return;
  try {
    localStorage.setItem(cacheKey(orgId), JSON.stringify(data));
    if (data?.version != null) {
      localStorage.setItem(versionKey(orgId), String(data.version));
    }
  } catch {}
}

export function isDirty(orgId) {
  if (!orgId) return false;
  try {
    return localStorage.getItem(dirtyKey(orgId)) === "1";
  } catch {
    return false;
  }
}

export function setDirty(orgId, v) {
  if (!orgId) return;
  try {
    if (v) localStorage.setItem(dirtyKey(orgId), "1");
    else localStorage.removeItem(dirtyKey(orgId));
  } catch {}
}

export function getCachedVersion(orgId) {
  try {
    const v = localStorage.getItem(versionKey(orgId));
    return v != null ? Number(v) : null;
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function signup({ email, password, name, orgName }) {
  return request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name, orgName }),
  });
}

export function login({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function fetchMe() {
  return request("/api/me");
}

export function deleteAccount() {
  return request("/api/account", { method: "DELETE" });
}

export function oauthStartUrl(provider) {
  return `/api/auth/${provider}/start`;
}

export function createOrg(name) {
  return request("/api/orgs", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function fetchOrgDB(orgId) {
  return request(`/api/orgs/${orgId}/db`);
}

export function pushOrgDB(orgId, data) {
  return request(`/api/orgs/${orgId}/db`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function fetchOrgBranding(orgId) {
  return request(`/api/orgs/${orgId}/branding`);
}

export function updateOrgBranding(orgId, patch) {
  return request(`/api/orgs/${orgId}/branding`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function forgotPassword(email) {
  return request("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token, password) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function fetchInvitePreview(token) {
  return request(`/api/invites/${token}`);
}

export function acceptInvite(token, body) {
  return request(`/api/invites/${token}/accept`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export function listOrgInvites(orgId) {
  return request(`/api/orgs/${orgId}/invites`);
}

export function createOrgInvite(orgId, { email, role }) {
  return request(`/api/orgs/${orgId}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export function fetchNotifications(orgId, unreadOnly = false) {
  const q = unreadOnly ? "?unread=1" : "";
  return request(`/api/orgs/${orgId}/notifications${q}`);
}

export function markNotificationsRead(orgId, ids) {
  return request(`/api/orgs/${orgId}/notifications/read`, {
    method: "POST",
    body: JSON.stringify({ ids: ids || [] }),
  });
}
