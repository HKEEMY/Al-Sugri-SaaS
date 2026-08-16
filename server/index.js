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

const DEFAULT_KOYOS = ["Koyo 1", "Koyo 2"];

function serverToday() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFactoryData(data) {
  const next = { ...(data || {}) };
  next.inventory = {
    emptyBags: Number(next.inventory?.emptyBags) || 0,
    finishedBags: Number(next.inventory?.finishedBags) || 0,
  };
  next.intake = Array.isArray(next.intake) ? next.intake : [];
  next.rolls = Array.isArray(next.rolls) ? next.rolls : [];
  next.production = Array.isArray(next.production) ? next.production : [];
  next.expenses = Array.isArray(next.expenses) ? next.expenses : [];
  next.salesFactory = Array.isArray(next.salesFactory) ? next.salesFactory : [];
  next.salesMobile = Array.isArray(next.salesMobile) ? next.salesMobile : [];
  next.sellers = Array.isArray(next.sellers) ? next.sellers : [];
  next.koyos = Array.isArray(next.koyos) && next.koyos.length
    ? [...new Set(next.koyos.map((k) => String(k).trim()).filter(Boolean))]
    : [...DEFAULT_KOYOS];
  return next;
}

function validationError(message) {
  const err = new Error(message);
  err.status = 422;
  return err;
}

/**
 * Business rules that must be enforced by the API, not just by the React UI.
 * The existing JSON-store architecture means the client submits a whole
 * organization document, so we validate the transition from the stored state
 * to the requested state.
 */
function validateFactoryTransition(currentRaw, incomingRaw, membership) {
  const current = normalizeFactoryData(currentRaw);
  const incoming = normalizeFactoryData(incomingRaw);

  if (incoming.inventory.emptyBags < 0 || incoming.inventory.finishedBags < 0) {
    throw validationError("Inventory quantities cannot be negative.");
  }

  const currentProductions = new Map((current.production || []).map((p) => [p.id, p]));
  const incomingProductions = new Map((incoming.production || []).map((p) => [p.id, p]));
  const today = serverToday();

  // Production records may not be backdated/forward-dated when created, and
  // existing production records cannot be edited in-place.
  for (const p of incoming.production) {
    if (!p?.id) throw validationError("Every production record must have an id.");
    const existing = currentProductions.get(p.id);
    if (!existing) {
      if (p.date !== today) {
        throw validationError(`Production can only be recorded for today (${today}).`);
      }
      if (!p.koyo || !incoming.koyos.includes(p.koyo)) {
        throw validationError("Production requires a valid assigned Koyo.");
      }
      if (!p.rollId) {
        throw validationError("Production requires a roll assigned to the selected Koyo.");
      }
      const roll = current.rolls.find((r) => r.id === p.rollId);
      if (!roll) throw validationError("The selected production roll does not exist.");
      if (roll.row !== p.koyo) {
        throw validationError("The selected roll is not assigned to the selected Koyo.");
      }
      if (!(Number(p.produced) > 0)) throw validationError("Production quantity must be greater than zero.");
      if (!(Number(p.rawUsedKg) > 0)) throw validationError("Raw material used must be greater than zero.");
      if (!(Number(p.leakage) >= 0 && Number(p.leakage) <= Number(p.produced))) {
        throw validationError("Leakages/rejects must be between zero and bags produced.");
      }
    } else if (JSON.stringify(existing) !== JSON.stringify(p)) {
      throw validationError("Existing production records cannot be edited. Use the authorized correction process.");
    }
  }

  // Deleted production is allowed only for today's records and only to
  // owner/supervisor. This keeps ordinary users from silently rewriting history.
  for (const [id, existing] of currentProductions) {
    if (!incomingProductions.has(id)) {
      if (existing.date !== today) {
        throw validationError("Historical production records cannot be deleted.");
      }
      if (!["owner", "supervisor"].includes(membership.role)) {
        throw validationError("You are not authorized to delete production records.");
      }
    }
  }

  // Check newly-added production against the inventory and roll quantities that
  // existed before this request. A client cannot manufacture inventory simply
  // by submitting a larger inventory number in the same request.
  let packagingAvailable = Number(current.inventory.emptyBags) || 0;
  const rollRemaining = new Map(current.rolls.map((r) => [r.id, Number(r.remainingKg) || 0]));

  // Deletions restore their resources before any same-request additions.
  for (const [id, existing] of currentProductions) {
    if (!incomingProductions.has(id)) {
      packagingAvailable += Number(existing.produced) || 0;
      if (existing.rollId) {
        rollRemaining.set(
          existing.rollId,
          (rollRemaining.get(existing.rollId) || 0) + (Number(existing.rawUsedKg) || 0)
        );
      }
    }
  }

  const added = incoming.production.filter((p) => !currentProductions.has(p.id));
  for (const p of added) {
    const produced = Number(p.produced) || 0;
    const rawUsed = Number(p.rawUsedKg) || 0;
    if (produced > packagingAvailable) {
      throw validationError(
        `Production blocked: only ${packagingAvailable.toLocaleString()} packaging bags are available, but ${produced.toLocaleString()} were requested.`
      );
    }
    const rollAvailable = rollRemaining.get(p.rollId);
    if (rollAvailable == null) throw validationError("The selected production roll is unavailable.");
    if (rawUsed > rollAvailable) {
      throw validationError(
        `Production blocked: the selected roll has only ${rollAvailable.toLocaleString()} kg remaining.`
      );
    }
    packagingAvailable -= produced;
    rollRemaining.set(p.rollId, rollAvailable - rawUsed);
  }

  // The client must reflect the production consumption in its submitted state.
  const expectedPackaging = packagingAvailable;
  if (added.length || [...currentProductions.keys()].some((id) => !incomingProductions.has(id))) {
    if (Number(incoming.inventory.emptyBags) !== expectedPackaging) {
      throw validationError(
        `Packaging-bag inventory is inconsistent with production. Expected ${expectedPackaging.toLocaleString()} bags after this change.`
      );
    }
  }

  // Any newly assigned/changed roll must reference a configured Koyo.
  for (const r of incoming.rolls) {
    if (r.row && !incoming.koyos.includes(r.row)) {
      throw validationError(`Roll ${r.label || r.id} is assigned to a Koyo that does not exist.`);
    }
  }

  // Prevent removing a Koyo that is referenced by a roll or production history.
  const currentKoyos = new Set(current.koyos);
  const incomingKoyos = new Set(incoming.koyos);
  for (const koyo of currentKoyos) {
    if (!incomingKoyos.has(koyo)) {
      const referenced = current.rolls.some((r) => r.row === koyo) ||
        current.production.some((p) => p.koyo === koyo);
      if (referenced) {
        throw validationError(`${koyo} cannot be removed because existing records reference it.`);
      }
    }
  }

  return incoming;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => `auth:${req.ip}:${req.path}`,
});

const FRONTEND_URL = (process.env.APP_URL || "").replace(/\/$/, "");

// ---------- Public ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, product: "Al Sugri Ops SaaS", version: "2.2.0" });
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

    const current = getOrgData(req.params.orgId).data;

    // Sellers: only sales + seller balances may change
    if (req.membership.role === "seller") {
      payload = applySellerWriteFilter(current, payload);
    }

    payload = validateFactoryTransition(current, payload, req.membership);

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
