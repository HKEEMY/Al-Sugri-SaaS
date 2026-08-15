import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import {
  createUserWithOrg,
  loginUser,
  listOrgsForUser,
  getMembership,
  createOrgForUser,
  getOrgData,
  putOrgData,
  getUserById,
  verifyToken,
  updateOrgBranding,
  requestPasswordReset,
  resetPasswordWithToken,
  createInvite,
  listInvites,
  acceptInvite,
  getInvitePreview,
  deleteAccount,
  findOrCreateOAuthUser,
} from "./auth.js";
import { buildAuthorizeUrl, handleCallback } from "./oauth.js";
import { rateLimit, applySellerWriteFilter } from "./security.js";
import {
  listNotifications,
  markNotificationsRead,
  scanSellerOutstanding,
  pushInApp,
} from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = verifyToken(token);
    const user = getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireOrgMember(req, res, next) {
  const membership = getMembership(req.user.id, req.params.orgId);
  if (!membership) {
    return res.status(403).json({ error: "You are not a member of this organization" });
  }
  req.membership = membership;
  next();
}

function canWrite(membership) {
  return ["owner", "supervisor", "seller"].includes(membership.role);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => `auth:${req.ip}:${req.path}`,
});

const FRONTEND_URL = (process.env.APP_URL || "").replace(/\/$/, "");

// ---------- Public ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, product: "Al Sugri Ops SaaS", version: "2.1.0" });
});

app.post("/api/auth/signup", authLimiter, (req, res) => {
  try {
    const { email, password, name, orgName } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const result = createUserWithOrg({ email, password, name, orgName });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Signup failed" });
  }
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const result = loginUser({ email, password });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Login failed" });
  }
});

app.post("/api/auth/forgot-password", authLimiter, (req, res) => {
  try {
    const result = requestPasswordReset(req.body?.email);
    res.json({
      ...result,
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Request failed" });
  }
});

app.post("/api/auth/reset-password", authLimiter, (req, res) => {
  try {
    const result = resetPasswordWithToken(req.body?.token, req.body?.password);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Reset failed" });
  }
});

app.get("/api/invites/:token", (req, res) => {
  try {
    res.json(getInvitePreview(req.params.token));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Invalid invite" });
  }
});

app.post("/api/invites/:token/accept", authLimiter, (req, res) => {
  try {
    // Optional: accept while already logged in
    let existingUserId = null;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      try {
        const payload = verifyToken(token);
        existingUserId = payload.sub;
      } catch {
        /* ignore */
      }
    }
    const result = acceptInvite({
      token: req.params.token,
      password: req.body?.password,
      name: req.body?.name,
      existingUserId,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not accept invite" });
  }
});

// ---- Social sign-in (Google / Facebook / X) ----
app.get("/api/auth/:provider/start", authLimiter, (req, res) => {
  try {
    res.redirect(buildAuthorizeUrl(req.params.provider));
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/?authError=${encodeURIComponent(err.message)}`);
  }
});

app.get("/api/auth/:provider/callback", authLimiter, async (req, res) => {
  try {
    const profile = await handleCallback(req.params.provider, req.query);
    const result = findOrCreateOAuthUser({
      provider: req.params.provider,
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name,
    });
    res.redirect(`${FRONTEND_URL}/#oauth_token=${encodeURIComponent(result.token)}`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/?authError=${encodeURIComponent(err.message || "Sign-in failed")}`);
  }
});

// ---------- Authenticated ----------
app.get("/api/me", authRequired, (req, res) => {
  const orgs = listOrgsForUser(req.user.id);
  res.json({ user: req.user, orgs });
});

app.delete("/api/account", authRequired, (req, res) => {
  try {
    const result = deleteAccount(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not delete account" });
  }
});

app.get("/api/orgs", authRequired, (req, res) => {
  res.json({ orgs: listOrgsForUser(req.user.id) });
});

app.post("/api/orgs", authRequired, (req, res) => {
  try {
    const org = createOrgForUser(req.user.id, req.body?.name);
    res.status(201).json({ org });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not create organization" });
  }
});

app.get("/api/orgs/:orgId/db", authRequired, requireOrgMember, (req, res) => {
  try {
    const { data, version, updatedAt } = getOrgData(req.params.orgId);
    res.json({
      ...data,
      version,
      updatedAt,
      _membership: {
        role: req.membership.role,
        sellerName: req.membership.sellerName,
        orgName: req.membership.name,
        branding: req.membership.branding,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to load data" });
  }
});

app.put("/api/orgs/:orgId/db", authRequired, requireOrgMember, (req, res) => {
  try {
    if (!canWrite(req.membership)) {
      return res.status(403).json({ error: "Read-only access" });
    }
    const body = req.body || {};
    const expectedVersion = body.version;
    let payload = { ...body };
    delete payload.version;
    delete payload.updatedAt;
    delete payload._membership;

    // Sellers: only sales + seller balances may change
    if (req.membership.role === "seller") {
      const current = getOrgData(req.params.orgId).data;
      payload = applySellerWriteFilter(current, payload);
    }

    const { data, version, updatedAt } = putOrgData(req.params.orgId, payload, expectedVersion);

    // Fire seller-owing alerts when data changes (owners/supervisors care)
    try {
      scanSellerOutstanding(req.params.orgId, req.membership.name);
    } catch {
      /* non-fatal */
    }

    res.json({
      ...data,
      version,
      updatedAt,
      _membership: {
        role: req.membership.role,
        sellerName: req.membership.sellerName,
        orgName: req.membership.name,
        branding: req.membership.branding,
      },
    });
  } catch (err) {
    const payload = { error: err.message || "Failed to save data" };
    if (err.status === 409) payload.conflict = true;
    res.status(err.status || 500).json(payload);
  }
});

app.get("/api/orgs/:orgId/branding", authRequired, requireOrgMember, (req, res) => {
  res.json({
    id: req.membership.id,
    name: req.membership.name,
    slug: req.membership.slug,
    branding: req.membership.branding,
  });
});

app.patch("/api/orgs/:orgId/branding", authRequired, requireOrgMember, (req, res) => {
  try {
    if (req.membership.role !== "owner" && req.membership.role !== "supervisor") {
      return res.status(403).json({ error: "Only owners and supervisors can change branding" });
    }
    const updated = updateOrgBranding(req.params.orgId, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to update branding" });
  }
});

// ---- Invites ----
app.get("/api/orgs/:orgId/invites", authRequired, requireOrgMember, (req, res) => {
  if (req.membership.role !== "owner") {
    return res.status(403).json({ error: "Only owners can manage invites" });
  }
  res.json({ invites: listInvites(req.params.orgId) });
});

app.post("/api/orgs/:orgId/invites", authRequired, requireOrgMember, (req, res) => {
  try {
    if (req.membership.role !== "owner") {
      return res.status(403).json({ error: "Only owners can invite teammates" });
    }
    const invite = createInvite({
      orgId: req.params.orgId,
      email: req.body?.email,
      role: req.body?.role || "supervisor",
      inviterUserId: req.user.id,
      inviterName: req.user.name,
      orgName: req.membership.name,
    });
    res.status(201).json({ invite });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Invite failed" });
  }
});

// ---- Notifications ----
app.get("/api/orgs/:orgId/notifications", authRequired, requireOrgMember, (req, res) => {
  const unreadOnly = req.query.unread === "1";
  // Scan outstanding when list is fetched so banners stay fresh
  try {
    if (req.membership.role === "owner" || req.membership.role === "supervisor") {
      scanSellerOutstanding(req.params.orgId, req.membership.name);
    }
  } catch {
    /* ignore */
  }
  const items = listNotifications(req.params.orgId, {
    userId: req.user.id,
    unreadOnly,
  });
  res.json({
    notifications: items,
    unread: items.filter((n) => !n.read).length,
  });
});

app.post("/api/orgs/:orgId/notifications/read", authRequired, requireOrgMember, (req, res) => {
  const remaining = markNotificationsRead(req.params.orgId, req.body?.ids);
  res.json({ ok: true, unread: remaining });
});

app.post("/api/orgs/:orgId/notifications/test", authRequired, requireOrgMember, (req, res) => {
  if (req.membership.role !== "owner") {
    return res.status(403).json({ error: "Owner only" });
  }
  const item = pushInApp(req.params.orgId, {
    type: "info",
    title: "Test notification",
    body: "In-app alerts are working. Email/SMS use console in development unless you configure providers.",
  });
  res.json({ notification: item });
});

// Production: serve built frontend
if (process.env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Al Sugri Ops SaaS listening on port ${PORT}`);
  console.log(`  Auth: signup | login | forgot-password | reset-password`);
  console.log(`  Invites + notifications enabled`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`  Email/SMS: console mode (set EMAIL_PROVIDER / SMS_PROVIDER for real delivery)`);
  }
});
