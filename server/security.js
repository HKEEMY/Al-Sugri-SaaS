/**
 * Production JWT handling + simple in-memory rate limiting.
 * Rate limits reset on process restart (fine for single-instance v1).
 */

import crypto from "crypto";

const buckets = new Map();

/**
 * Resolve JWT signing secret.
 * In production, JWT_SECRET should be set on the *service* (not only Shared Variables).
 * If missing, we start with an ephemeral secret so deploy is not bricked — sessions
 * reset on every restart until a real JWT_SECRET is configured.
 */
export function assertJwtSecret() {
  let secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  // Helpful diagnostics (never print the secret itself)
  if (isProd) {
    const len = secret ? String(secret).length : 0;
    console.log(
      `[security] JWT_SECRET present=${Boolean(secret)} length=${len} NODE_ENV=${process.env.NODE_ENV}`
    );
  }

  if (isProd && (!secret || secret.length < 24 || String(secret).includes("change-me"))) {
    secret = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[security] WARNING: JWT_SECRET is missing or too weak on this service.\n" +
        "  Using a temporary secret for this process only (logins reset on restart).\n" +
        "  Fix: Railway → click your app SERVICE (not Project Settings) → Variables →\n" +
        "  add JWT_SECRET = a long random string (24+ chars), then Redeploy."
    );
  }

  return secret || "al-sugri-dev-secret-change-me-in-production";
}

/**
 * Express middleware: limit requests per key (IP + route).
 * @param {{ windowMs?: number, max?: number, keyFn?: (req) => string }} opts
 */
export function rateLimit(opts = {}) {
  const windowMs = opts.windowMs ?? 15 * 60 * 1000;
  const max = opts.max ?? 30;
  const keyFn =
    opts.keyFn ||
    ((req) => `${req.ip || req.socket?.remoteAddress || "unknown"}:${req.path}`);

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      return res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again.",
      });
    }
    next();
  };
}

/** Sellers may only touch sales-related + sellers list fields when saving the blob. */
export function applySellerWriteFilter(currentData, incoming) {
  const next = { ...currentData };
  if (incoming.salesFactory != null) next.salesFactory = incoming.salesFactory;
  if (incoming.salesMobile != null) next.salesMobile = incoming.salesMobile;
  if (incoming.sellers != null) next.sellers = incoming.sellers;
  return next;
}
