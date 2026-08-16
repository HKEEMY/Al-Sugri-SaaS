import crypto from "crypto";

/** Manual OAuth 2.0 authorization-code flow for Google, Facebook, and X.
 * No extra dependency — relies on Node's built-in fetch (Node 18+). */

function redirectUriFor(provider) {
  const base = (process.env.OAUTH_REDIRECT_BASE || process.env.APP_URL || "").replace(/\/$/, "");
  return `${base}/api/auth/${provider}/callback`;
}

const PROVIDERS = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    pkce: false,
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    parseProfile: (p) => ({ providerId: p.sub, email: p.email || null, name: p.name || null }),
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    userUrl: "https://graph.facebook.com/me?fields=id,name,email",
    scope: "email public_profile",
    pkce: false,
    clientId: () => process.env.FACEBOOK_CLIENT_ID,
    clientSecret: () => process.env.FACEBOOK_CLIENT_SECRET,
    parseProfile: (p) => ({ providerId: p.id, email: p.email || null, name: p.name || null }),
  },
  // X's OAuth 2.0 user context requires PKCE. Its API does not hand back an
  // email address without extra elevated access, so X accounts fall back to
  // a placeholder email — see findOrCreateOAuthUser in auth.js.
  x: {
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    userUrl: "https://api.twitter.com/2/users/me",
    scope: "tweet.read users.read offline.access",
    pkce: true,
    clientId: () => process.env.TWITTER_CLIENT_ID,
    clientSecret: () => process.env.TWITTER_CLIENT_SECRET,
    parseProfile: (p) => ({ providerId: p.data?.id || null, email: null, name: p.data?.name || null }),
  },
};

// In-memory state store. Fine for a single-instance deploy (same assumption
// the JSON store already makes); entries expire after 10 minutes.
const pending = new Map();

function cleanupPending() {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (value.expiresAt < now) pending.delete(key);
  }
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider || !provider.clientId() || !provider.clientSecret()) return null;
  return provider;
}

export function buildAuthorizeUrl(providerName) {
  const provider = getProvider(providerName);
  if (!provider) {
    const err = new Error(`${providerName} sign-in isn't configured on this server yet`);
    err.status = 501;
    throw err;
  }
  cleanupPending();

  const state = base64url(crypto.randomBytes(24));
  const record = { provider: providerName, expiresAt: Date.now() + 10 * 60 * 1000 };

  const params = new URLSearchParams({
    client_id: provider.clientId(),
    redirect_uri: redirectUriFor(providerName),
    response_type: "code",
    scope: provider.scope,
    state,
  });

  if (provider.pkce) {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    record.codeVerifier = verifier;
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }

  pending.set(state, record);
  console.info(`[oauth] ${providerName} authorize redirect=${redirectUriFor(providerName)} clientConfigured=${Boolean(provider.clientId())}`);
  return `${provider.authUrl}?${params.toString()}`;
}

export async function handleCallback(providerName, { code, state, error }) {
  if (error) {
    const err = new Error(String(error));
    err.status = 400;
    throw err;
  }
  const provider = getProvider(providerName);
  if (!provider) {
    const err = new Error(`${providerName} sign-in isn't configured on this server yet`);
    err.status = 501;
    throw err;
  }

  const record = pending.get(state);
  if (!record || record.provider !== providerName || record.expiresAt < Date.now()) {
    const err = new Error("Sign-in session expired — try again");
    err.status = 400;
    throw err;
  }
  pending.delete(state);

  const tokenBody = new URLSearchParams({
    client_id: provider.clientId(),
    client_secret: provider.clientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriFor(providerName),
  });
  if (record.codeVerifier) tokenBody.set("code_verifier", record.codeVerifier);

  const tokenRes = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error(`[oauth] ${providerName} token exchange failed status=${tokenRes.status} error=${tokenJson.error || "unknown"} description=${tokenJson.error_description || "none"}`);
    const err = new Error(tokenJson.error_description || `${providerName} sign-in failed`);
    err.status = 400;
    throw err;
  }

  const profileRes = await fetch(provider.userUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profileJson = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok) {
    console.error(`[oauth] ${providerName} profile request failed status=${profileRes.status}`);
    const err = new Error(`Could not read ${providerName} profile`);
    err.status = 400;
    throw err;
  }

  const profile = provider.parseProfile(profileJson);
  if (!profile.providerId) {
    const err = new Error(`${providerName} didn't return an account id`);
    err.status = 400;
    throw err;
  }
  return profile;
}
