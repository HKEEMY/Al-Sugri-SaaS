/**
 * Notifications: in-app (stored), email + SMS adapters.
 *
 * Dev default: console logging (no external account needed).
 * Production: set env vars to wire real providers.
 *
 * EMAIL_PROVIDER=console|smtp
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 * SMS_PROVIDER=console|twilio
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * APP_BASE_URL=https://your-app.example.com  (links in emails)
 */

import { store, uid } from "./db.js";

const APP_BASE = process.env.APP_BASE_URL || "http://localhost:5173";

export async function sendEmail({ to, subject, text, html }) {
  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  if (provider === "smtp" && process.env.SMTP_HOST) {
    // Lightweight SMTP via raw fetch is not ideal; use nodemailer when installed.
    // Fallback: log + try dynamic import
    try {
      const nodemailer = await import("nodemailer").catch(() => null);
      if (nodemailer) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === "true",
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        });
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.SMTP_USER,
          to,
          subject,
          text,
          html: html || text,
        });
        return { ok: true, provider: "smtp" };
      }
    } catch (err) {
      console.error("[email] SMTP failed:", err.message);
    }
  }
  console.log(`[email:console] to=${to}\n  subject=${subject}\n  ${text}`);
  return { ok: true, provider: "console" };
}

export async function sendSms({ to, body }) {
  const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();
  if (provider === "twilio" && process.env.TWILIO_ACCOUNT_SID) {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString("base64");
      const params = new URLSearchParams({
        To: to,
        From: process.env.TWILIO_FROM,
        Body: body,
      });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
      if (!res.ok) throw new Error(await res.text());
      return { ok: true, provider: "twilio" };
    } catch (err) {
      console.error("[sms] Twilio failed:", err.message);
    }
  }
  console.log(`[sms:console] to=${to}\n  ${body}`);
  return { ok: true, provider: "console" };
}

function ensureOrgNotifs(s, orgId) {
  if (!s.notifications) s.notifications = {};
  if (!s.notifications[orgId]) s.notifications[orgId] = [];
  return s.notifications[orgId];
}

export function pushInApp(orgId, { type, title, body, userId = null, meta = {} }) {
  return store.update((s) => {
    const list = ensureOrgNotifs(s, orgId);
    const item = {
      id: uid(),
      type: type || "info",
      title,
      body: body || "",
      userId,
      meta,
      read: false,
      createdAt: Date.now(),
    };
    list.unshift(item);
    // keep last 200
    s.notifications[orgId] = list.slice(0, 200);
    return item;
  });
}

export function listNotifications(orgId, { userId, unreadOnly = false } = {}) {
  const s = store.read();
  let list = (s.notifications && s.notifications[orgId]) || [];
  if (userId) {
    list = list.filter((n) => !n.userId || n.userId === userId);
  }
  if (unreadOnly) list = list.filter((n) => !n.read);
  return list;
}

export function markNotificationsRead(orgId, ids) {
  return store.update((s) => {
    const list = ensureOrgNotifs(s, orgId);
    const set = new Set(ids || []);
    for (const n of list) {
      if (!ids || ids.length === 0 || set.has(n.id)) n.read = true;
    }
    return list.filter((n) => !n.read).length;
  });
}

/** Scan sellers with positive balance and create alerts (deduped per day). */
export function scanSellerOutstanding(orgId, orgName) {
  const s = store.read();
  const row = s.orgData[orgId];
  if (!row?.data?.sellers) return [];
  const sellers = row.data.sellers.filter((x) => Number(x.balance) > 0);
  if (!sellers.length) return [];

  const created = [];
  const dayKey = new Date().toISOString().slice(0, 10);
  store.update((st) => {
    const list = ensureOrgNotifs(st, orgId);
    for (const seller of sellers) {
      const dedupe = `owing:${seller.name}:${dayKey}`;
      if (list.some((n) => n.meta?.dedupe === dedupe)) continue;
      const amount = Number(seller.balance) || 0;
      const item = {
        id: uid(),
        type: "alert",
        title: `${seller.name} owes money`,
        body: `${seller.name} has an outstanding balance of ${amount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}. Follow up before end of day.`,
        userId: null,
        meta: { dedupe, sellerName: seller.name, balance: amount },
        read: false,
        createdAt: Date.now(),
      };
      list.unshift(item);
      created.push(item);
    }
    st.notifications[orgId] = list.slice(0, 200);
  });

  // Optional email to org owners (console in dev)
  if (created.length) {
    const owners = s.memberships
      .filter((m) => m.org_id === orgId && m.role === "owner")
      .map((m) => s.users.find((u) => u.id === m.user_id))
      .filter(Boolean);
    const summary = created.map((c) => `• ${c.title}: ${c.body}`).join("\n");
    for (const owner of owners) {
      sendEmail({
        to: owner.email,
        subject: `[${orgName || "Factory"}] ${created.length} seller balance alert(s)`,
        text: `Outstanding seller balances for ${orgName || "your factory"}:\n\n${summary}\n\nOpen the app: ${APP_BASE}`,
      }).catch(() => {});
    }
  }
  return created;
}

export function notifyPasswordReset(email, token) {
  const link = `${APP_BASE}/?reset=${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: "Reset your Al Sugri Ops password",
    text: `You requested a password reset.\n\nOpen this link (valid 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
  });
}

export function notifyInvite({ email, orgName, role, token, inviterName }) {
  const link = `${APP_BASE}/?invite=${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: `You're invited to ${orgName} on Al Sugri Ops`,
    text: `${inviterName || "A teammate"} invited you to join ${orgName} as ${role}.\n\nAccept here:\n${link}\n\nThis link expires in 7 days.`,
  });
}

export { APP_BASE };
