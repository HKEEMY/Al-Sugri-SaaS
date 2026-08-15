import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { store, uid, slugify, emptyFactoryData } from "./db.js";
import { assertJwtSecret } from "./security.js";
import { notifyPasswordReset, notifyInvite, pushInApp } from "./notify.js";

const JWT_SECRET = assertJwtSecret();
const JWT_EXPIRES = process.env.JWT_EXPIRES || "30d";

/** Default look — Al Sugri industrial palette until the owner customizes it. */
export function defaultBranding() {
  return {
    logo: null,
    accentColor: "#2FD8C7",
    bgColor: "#0B1E2C",
    panelColor: "#122B3D",
    setupComplete: false,
  };
}

function publicOrg(o, membership) {
  const branding = { ...defaultBranding(), ...(o.branding || {}) };
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    role: membership.role,
    sellerName: membership.seller_name || null,
    branding,
  };
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function createUserWithOrg({ email, password, name, orgName }) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm || !password) {
    const err = new Error("Email and password are required");
    err.status = 400;
    throw err;
  }
  if (password.length < 6) {
    const err = new Error("Password must be at least 6 characters");
    err.status = 400;
    throw err;
  }
  if (!orgName || !String(orgName).trim()) {
    const err = new Error("Factory / organization name is required");
    err.status = 400;
    throw err;
  }

  return store.update((s) => {
    if (s.users.some((u) => u.email === emailNorm)) {
      const err = new Error("An account with this email already exists");
      err.status = 409;
      throw err;
    }
    const userId = uid();
    const orgId = uid();
    const membershipId = uid();
    const now = Date.now();
    const displayName = (name || emailNorm.split("@")[0]).trim();
    const orgDisplay = String(orgName).trim();
    const slug = slugify(orgDisplay);

    s.users.push({
      id: userId,
      email: emailNorm,
      password_hash: hashPassword(password),
      name: displayName,
      created_at: now,
    });
    s.organizations.push({ id: orgId, name: orgDisplay, slug, created_at: now, branding: defaultBranding() });
    s.memberships.push({
      id: membershipId,
      user_id: userId,
      org_id: orgId,
      role: "owner",
      seller_name: null,
      created_at: now,
    });
    s.orgData[orgId] = {
      data: emptyFactoryData(),
      version: 1,
      updated_at: now,
    };

    return {
      user: { id: userId, email: emailNorm, name: displayName },
      org: { id: orgId, name: orgDisplay, slug, role: "owner", sellerName: null, branding: defaultBranding() },
      token: signToken({ sub: userId, email: emailNorm }),
    };
  });
}

export function loginUser({ email, password }) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const s = store.read();
  const user = s.users.find((u) => u.email === emailNorm);
  if (!user) {
    const err = new Error("Invalid email or password");
    err.status = 401;
    throw err;
  }
  if (!user.password_hash) {
    const err = new Error("This account signs in with Google, Facebook, or X — use that button instead");
    err.status = 401;
    throw err;
  }
  if (!verifyPassword(password, user.password_hash)) {
    const err = new Error("Invalid email or password");
    err.status = 401;
    throw err;
  }
  const orgs = listOrgsForUser(user.id);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    orgs,
    token: signToken({ sub: user.id, email: user.email }),
  };
}

export function listOrgsForUser(userId) {
  const s = store.read();
  return s.memberships
    .filter((m) => m.user_id === userId)
    .map((m) => {
      const o = s.organizations.find((org) => org.id === m.org_id);
      if (!o) return null;
      return publicOrg(o, m);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getMembership(userId, orgId) {
  const s = store.read();
  const m = s.memberships.find((x) => x.user_id === userId && x.org_id === orgId);
  if (!m) return null;
  const o = s.organizations.find((org) => org.id === orgId);
  if (!o) return null;
  return {
    role: m.role,
    sellerName: m.seller_name || null,
    id: o.id,
    name: o.name,
    slug: o.slug,
    branding: { ...defaultBranding(), ...(o.branding || {}) },
  };
}

export function createOrgForUser(userId, orgName) {
  if (!orgName || !String(orgName).trim()) {
    const err = new Error("Factory name is required");
    err.status = 400;
    throw err;
  }
  return store.update((s) => {
    const orgId = uid();
    const membershipId = uid();
    const now = Date.now();
    const name = String(orgName).trim();
    const slug = slugify(name);
    s.organizations.push({ id: orgId, name, slug, created_at: now, branding: defaultBranding() });
    s.memberships.push({
      id: membershipId,
      user_id: userId,
      org_id: orgId,
      role: "owner",
      seller_name: null,
      created_at: now,
    });
    s.orgData[orgId] = { data: emptyFactoryData(), version: 1, updated_at: now };
    return { id: orgId, name, slug, role: "owner", sellerName: null, branding: defaultBranding() };
  });
}

export function getOrgData(orgId) {
  const s = store.read();
  const row = s.orgData[orgId];
  if (!row) {
    const err = new Error("Organization data not found");
    err.status = 404;
    throw err;
  }
  return {
    data: row.data,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function putOrgData(orgId, nextData, expectedVersion) {
  return store.update((s) => {
    const row = s.orgData[orgId];
    if (!row) {
      const err = new Error("Organization data not found");
      err.status = 404;
      throw err;
    }
    if (expectedVersion != null && Number(expectedVersion) !== row.version) {
      const err = new Error("Conflict: data was updated elsewhere. Refresh and try again.");
      err.status = 409;
      err.currentVersion = row.version;
      throw err;
    }
    const now = Date.now();
    const newVersion = row.version + 1;
    const payload = { ...nextData };
    delete payload.version;
    delete payload.updatedAt;
    delete payload._membership;
    s.orgData[orgId] = { data: payload, version: newVersion, updated_at: now };
    return { data: payload, version: newVersion, updatedAt: now };
  });
}

export function getUserById(userId) {
  const s = store.read();
  const u = s.users.find((x) => x.id === userId);
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, created_at: u.created_at };
}

/** Permanently deletes a user's account.
 * - Orgs where this user is the sole member are deleted entirely, including their data.
 * - Orgs with other members but no other owner block deletion (transfer ownership first).
 * - Orgs with another owner just lose this user's membership. */
export function deleteAccount(userId) {
  return store.update((s) => {
    const user = s.users.find((u) => u.id === userId);
    if (!user) {
      const err = new Error("User not found");
      err.status = 404;
      throw err;
    }

    const memberships = s.memberships.filter((m) => m.user_id === userId);

    for (const m of memberships) {
      if (m.role !== "owner") continue;
      const others = s.memberships.filter((x) => x.org_id === m.org_id && x.user_id !== userId);
      const anotherOwner = others.some((x) => x.role === "owner");
      if (others.length > 0 && !anotherOwner) {
        const org = s.organizations.find((o) => o.id === m.org_id);
        const err = new Error(
          `You're the only owner of "${org?.name || "an organization"}", which has other members. Transfer ownership or remove them before deleting your account.`
        );
        err.status = 409;
        throw err;
      }
    }

    for (const m of memberships) {
      if (m.role !== "owner") continue;
      const others = s.memberships.filter((x) => x.org_id === m.org_id && x.user_id !== userId);
      if (others.length === 0) {
        s.organizations = s.organizations.filter((o) => o.id !== m.org_id);
        delete s.orgData[m.org_id];
        s.invites = (s.invites || []).filter((i) => i.orgId !== m.org_id);
      }
    }

    s.memberships = s.memberships.filter((m) => m.user_id !== userId);
    s.users = s.users.filter((u) => u.id !== userId);
    s.passwordResets = (s.passwordResets || []).filter((r) => r.userId !== userId);

    return { ok: true };
  });
}

function listOrgsForUserInPlace(s, userId) {
  return s.memberships
    .filter((m) => m.user_id === userId)
    .map((m) => {
      const o = s.organizations.find((org) => org.id === m.org_id);
      if (!o) return null;
      return publicOrg(o, m);
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Finds or creates a user from an OAuth profile (Google / Facebook / X).
 * Matches first by provider+providerId, then by email. First-time sign-ins
 * get their own workspace, same as email signup. */
export function findOrCreateOAuthUser({ provider, providerId, email, name }) {
  const emailNorm = email ? String(email).trim().toLowerCase() : null;

  return store.update((s) => {
    let user = s.users.find((u) =>
      (u.oauthAccounts || []).some((a) => a.provider === provider && a.providerId === providerId)
    );

    if (!user && emailNorm) {
      user = s.users.find((u) => u.email === emailNorm);
      if (user) {
        user.oauthAccounts = user.oauthAccounts || [];
        user.oauthAccounts.push({ provider, providerId });
      }
    }

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const displayName = (name || (emailNorm ? emailNorm.split("@")[0] : null) || `${provider} user`).trim();
      user = {
        id: uid(),
        email: emailNorm || `${provider}_${providerId}@accounts.al-sugri-saas.local`,
        password_hash: null,
        name: displayName,
        created_at: Date.now(),
        oauthAccounts: [{ provider, providerId }],
      };
      s.users.push(user);
    }

    let orgs = listOrgsForUserInPlace(s, user.id);
    if (isNewUser || orgs.length === 0) {
      const orgId = uid();
      const now = Date.now();
      const orgDisplay = `${user.name}'s Workspace`;
      s.organizations.push({ id: orgId, name: orgDisplay, slug: slugify(orgDisplay), created_at: now, branding: defaultBranding() });
      s.memberships.push({
        id: uid(),
        user_id: user.id,
        org_id: orgId,
        role: "owner",
        seller_name: null,
        created_at: now,
      });
      s.orgData[orgId] = { data: emptyFactoryData(), version: 1, updated_at: now };
      orgs = listOrgsForUserInPlace(s, user.id);
    }

    return {
      user: { id: user.id, email: user.email, name: user.name },
      orgs,
      token: signToken({ sub: user.id, email: user.email }),
    };
  });
}


export function updateOrgBranding(orgId, patch) {
  return store.update((s) => {
    const o = s.organizations.find((x) => x.id === orgId);
    if (!o) {
      const err = new Error("Organization not found");
      err.status = 404;
      throw err;
    }
    const current = { ...defaultBranding(), ...(o.branding || {}) };
    const next = { ...current };

    if (patch.name != null) {
      const n = String(patch.name).trim();
      if (!n) {
        const err = new Error("Factory name cannot be empty");
        err.status = 400;
        throw err;
      }
      o.name = n;
    }
    if (patch.logo !== undefined) {
      if (patch.logo === null || patch.logo === "") {
        next.logo = null;
      } else {
        const logo = String(patch.logo);
        if (logo.length > 900_000) {
          const err = new Error("Logo is too large — use a smaller image (under ~600KB)");
          err.status = 400;
          throw err;
        }
        if (!logo.startsWith("data:image/")) {
          const err = new Error("Logo must be an image");
          err.status = 400;
          throw err;
        }
        next.logo = logo;
      }
    }
    if (patch.accentColor != null) next.accentColor = String(patch.accentColor);
    if (patch.bgColor != null) next.bgColor = String(patch.bgColor);
    if (patch.panelColor != null) next.panelColor = String(patch.panelColor);
    if (patch.setupComplete != null) next.setupComplete = Boolean(patch.setupComplete);

    o.branding = next;
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      branding: next,
    };
  });
}


function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** Request password reset — always returns ok (don't leak whether email exists). */
export function requestPasswordReset(email) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm) {
    const err = new Error("Email is required");
    err.status = 400;
    throw err;
  }
  const s = store.read();
  const user = s.users.find((u) => u.email === emailNorm);
  if (!user) {
    return { ok: true };
  }
  const token = randomToken();
  const expiresAt = Date.now() + 60 * 60 * 1000;
  store.update((st) => {
    if (!st.passwordResets) st.passwordResets = [];
    st.passwordResets = st.passwordResets.filter((r) => r.userId !== user.id && r.expiresAt > Date.now());
    st.passwordResets.push({ token, userId: user.id, expiresAt });
  });
  notifyPasswordReset(emailNorm, token).catch(() => {});
  return { ok: true };
}

export function resetPasswordWithToken(token, newPassword) {
  if (!token || !newPassword || String(newPassword).length < 6) {
    const err = new Error("Valid token and password (min 6 characters) are required");
    err.status = 400;
    throw err;
  }
  return store.update((s) => {
    if (!s.passwordResets) s.passwordResets = [];
    const row = s.passwordResets.find((r) => r.token === token && r.expiresAt > Date.now());
    if (!row) {
      const err = new Error("Reset link is invalid or has expired");
      err.status = 400;
      throw err;
    }
    const user = s.users.find((u) => u.id === row.userId);
    if (!user) {
      const err = new Error("User not found");
      err.status = 404;
      throw err;
    }
    user.password_hash = hashPassword(newPassword);
    s.passwordResets = s.passwordResets.filter((r) => r.token !== token);
    return { ok: true, email: user.email };
  });
}

export function createInvite({ orgId, email, role, inviterUserId, inviterName, orgName }) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const r = String(role || "supervisor").toLowerCase();
  if (!["supervisor", "seller", "owner"].includes(r)) {
    const err = new Error("Role must be owner, supervisor, or seller");
    err.status = 400;
    throw err;
  }
  if (!emailNorm) {
    const err = new Error("Email is required");
    err.status = 400;
    throw err;
  }
  const token = randomToken();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const invite = store.update((s) => {
    if (!s.invites) s.invites = [];
    const inv = {
      id: uid(),
      orgId,
      email: emailNorm,
      role: r,
      token,
      expiresAt,
      createdBy: inviterUserId,
      createdAt: Date.now(),
      acceptedAt: null,
    };
    s.invites.push(inv);
    return inv;
  });
  notifyInvite({ email: emailNorm, orgName, role: r, token, inviterName }).catch(() => {});
  pushInApp(orgId, {
    type: "info",
    title: "Invite sent",
    body: `Invitation emailed to ${emailNorm} as ${r}.`,
    meta: { email: emailNorm, role: r },
  });
  return { id: invite.id, email: emailNorm, role: r, expiresAt: invite.expiresAt };
}

export function listInvites(orgId) {
  const s = store.read();
  return (s.invites || [])
    .filter((i) => i.orgId === orgId && !i.acceptedAt)
    .map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      expired: i.expiresAt < Date.now(),
      createdAt: i.createdAt,
    }));
}

export function acceptInvite({ token, password, name, existingUserId }) {
  const result = store.update((s) => {
    if (!s.invites) s.invites = [];
    const inv = s.invites.find((i) => i.token === token && !i.acceptedAt);
    if (!inv || inv.expiresAt < Date.now()) {
      const err = new Error("Invite is invalid or has expired");
      err.status = 400;
      throw err;
    }
    const org = s.organizations.find((o) => o.id === inv.orgId);
    if (!org) {
      const err = new Error("Organization not found");
      err.status = 404;
      throw err;
    }

    let userId = existingUserId;
    let user;
    if (userId) {
      user = s.users.find((u) => u.id === userId);
      if (!user) {
        const err = new Error("Not signed in");
        err.status = 401;
        throw err;
      }
      if (user.email !== inv.email) {
        const err = new Error("This invite was sent to a different email address");
        err.status = 403;
        throw err;
      }
    } else {
      user = s.users.find((u) => u.email === inv.email);
      if (user) {
        const err = new Error("An account with this email exists — sign in, then open the invite link again");
        err.status = 409;
        throw err;
      }
      if (!password || String(password).length < 6) {
        const err = new Error("Password must be at least 6 characters");
        err.status = 400;
        throw err;
      }
      userId = uid();
      const displayName = (name || inv.email.split("@")[0]).trim();
      s.users.push({
        id: userId,
        email: inv.email,
        password_hash: hashPassword(password),
        name: displayName,
        created_at: Date.now(),
      });
      user = s.users.find((u) => u.id === userId);
    }

    const existing = s.memberships.find((m) => m.user_id === userId && m.org_id === inv.orgId);
    if (!existing) {
      s.memberships.push({
        id: uid(),
        user_id: userId,
        org_id: inv.orgId,
        role: inv.role,
        seller_name: inv.role === "seller" ? (user.name || null) : null,
        created_at: Date.now(),
      });
    }
    inv.acceptedAt = Date.now();

    return {
      user: { id: user.id, email: user.email, name: user.name },
      org: publicOrg(org, {
        role: inv.role,
        seller_name: inv.role === "seller" ? user.name : null,
      }),
      token: signToken({ sub: user.id, email: user.email }),
      _notify: {
        orgId: inv.orgId,
        title: "Teammate joined",
        body: `${user.name || user.email} joined as ${inv.role}.`,
      },
    };
  });
  if (result._notify) {
    pushInApp(result._notify.orgId, {
      type: "info",
      title: result._notify.title,
      body: result._notify.body,
    });
    delete result._notify;
  }
  return result;
}

export function getInvitePreview(token) {
  const s = store.read();
  const inv = (s.invites || []).find((i) => i.token === token && !i.acceptedAt);
  if (!inv || inv.expiresAt < Date.now()) {
    const err = new Error("Invite is invalid or has expired");
    err.status = 400;
    throw err;
  }
  const org = s.organizations.find((o) => o.id === inv.orgId);
  return {
    email: inv.email,
    role: inv.role,
    orgName: org?.name || "Factory",
    expiresAt: inv.expiresAt,
  };
}
