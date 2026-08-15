/**
 * Production JWT enforcement + simple in-memory rate limiting.
 * Rate limits reset on process restart (fine for single-instance v1).
 */

const buckets = new Map();

export function assertJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (!secret || secret.length < 24 || secret.includes("change-me")) {
      console.error(
        "[security] FATAL: Set JWT_SECRET to a long random string (>= 24 chars) before running in production."
      );
      process.exit(1);
    }
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
  // Keep everything else from current server copy
  return next;
}
