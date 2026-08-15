import React, { useState, useEffect } from "react";
import { Droplet } from "lucide-react";
import * as api from "./api.js";

const C = {
  bg: "#0B1E2C",
  panel: "#122B3D",
  panel2: "#173347",
  line: "#20465F",
  aqua: "#2FD8C7",
  amber: "#F0A83E",
  coral: "#E8604C",
  text: "#EAF3F5",
  mute: "#84A2B0",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  background: C.panel2,
  color: C.text,
  fontSize: 16,
  outline: "none",
};

const btnPrimary = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 10,
  border: "none",
  background: C.aqua,
  color: "#06201C",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

const btnGhost = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  background: "transparent",
  color: C.text,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const SOCIAL_PROVIDERS = [
  { id: "google", label: "Google", badgeBg: "#fff", badgeColor: "#000", glyph: "G" },
  { id: "facebook", label: "Facebook", badgeBg: "#1877F2", badgeColor: "#fff", glyph: "f" },
  { id: "x", label: "X", badgeBg: "#000", badgeColor: "#fff", glyph: "𝕏" },
];

function OAuthButtons() {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SOCIAL_PROVIDERS.map((p) => (
          <a
            key={p.id}
            href={api.oauthStartUrl(p.id)}
            style={{
              ...btnGhost,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              textDecoration: "none",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                background: p.badgeBg,
                color: p.badgeColor,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {p.glyph}
            </span>
            Continue with {p.label}
          </a>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
        <div style={{ flex: 1, height: 1, background: C.line }} />
        <span style={{ fontSize: 12, color: C.mute }}>or</span>
        <div style={{ flex: 1, height: 1, background: C.line }} />
      </div>
    </div>
  );
}

function Shell({ children, title, subtitle }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: C.panel,
              border: `1px solid ${C.line}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <Droplet size={28} color={C.aqua} />
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "Space Grotesk, Inter, sans-serif",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ color: C.mute, marginTop: 8, marginBottom: 0, fontSize: 14, lineHeight: 1.45 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 16,
            padding: 22,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginScreen({ onSuccess, onSwitchToSignup, onForgot }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.login({ email, password });
      api.setToken(result.token);
      onSuccess(result);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Al Sugri Ops" subtitle="Sign in to your factory workspace">
      <OAuthButtons />
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Email</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
          required
        />
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginBottom: 18 }}
          required
        />
        {error && (
          <div style={{ color: C.coral, fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button
          type="button"
          onClick={typeof onForgot === "function" ? onForgot : undefined}
          style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", fontSize: 13, padding: 0 }}
        >
          Forgot password?
        </button>
      </div>
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: C.mute }}>
        New here?{" "}
        <button
          type="button"
          onClick={onSwitchToSignup}
          style={{ background: "none", border: "none", color: C.aqua, cursor: "pointer", fontWeight: 600, padding: 0 }}
        >
          Create a workspace
        </button>
      </div>
    </Shell>
  );
}

export function SignupScreen({ onSuccess, onSwitchToLogin }) {
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.signup({ email, password, name, orgName });
      api.setToken(result.token);
      api.setSelectedOrgId(result.org.id);
      onSuccess(result);
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Create workspace"
      subtitle="One account, one factory to start. You can add more later."
    >
      <OAuthButtons />
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
          placeholder="e.g. Ama Mensah"
          required
        />
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Factory name</label>
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
          placeholder="e.g. Al Sugri Beverages"
          required
        />
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Work email</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
          required
        />
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Password (min 6)</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginBottom: 18 }}
          minLength={6}
          required
        />
        {error && (
          <div style={{ color: C.coral, fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
      </form>
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: C.mute }}>
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          style={{ background: "none", border: "none", color: C.aqua, cursor: "pointer", fontWeight: 600, padding: 0 }}
        >
          Sign in
        </button>
      </div>
    </Shell>
  );
}

export function OrgPicker({ user, orgs, onSelect, onCreate, onLogout, onAccountDeleted }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    setDeleteError("");
    setDeleting(true);
    try {
      await api.deleteAccount();
      onAccountDeleted?.();
    } catch (err) {
      setDeleteError(err.message || "Could not delete account");
    } finally {
      setDeleting(false);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { org } = await api.createOrg(newName);
      onCreate(org);
    } catch (err) {
      setError(err.message || "Could not create factory");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Choose factory" subtitle={`Signed in as ${user?.name || user?.email}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orgs.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(o)}
            style={{
              ...btnGhost,
              textAlign: "left",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              <div style={{ fontWeight: 700 }}>{o.name}</div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                {o.role}
                {o.sellerName ? ` · ${o.sellerName}` : ""}
              </div>
            </span>
            <span style={{ color: C.aqua, fontSize: 12 }}>Open →</span>
          </button>
        ))}
      </div>

      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{ ...btnGhost, marginTop: 14, borderStyle: "dashed" }}
        >
          + New factory
        </button>
      ) : (
        <form onSubmit={create} style={{ marginTop: 14 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Factory name"
            style={{ ...inputStyle, marginBottom: 10 }}
            required
          />
          {error && <div style={{ color: C.coral, fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ ...btnPrimary, flex: 1 }}>
              {busy ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setCreating(false)} style={{ ...btnGhost, flex: 1 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <button
        type="button"
        onClick={onLogout}
        style={{
          ...btnGhost,
          marginTop: 18,
          color: C.mute,
          borderColor: "transparent",
        }}
      >
        Sign out
      </button>

      <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            style={{ ...btnGhost, color: C.coral, borderColor: "transparent", fontSize: 12 }}
          >
            Delete account
          </button>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: C.mute, marginBottom: 10, lineHeight: 1.5 }}>
              This permanently deletes your account and any factory only you belong to. If you
              solely own a factory with other members, transfer ownership or remove them first.
            </div>
            {deleteError && (
              <div style={{ color: C.coral, fontSize: 13, marginBottom: 10 }}>{deleteError}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                style={{
                  ...btnPrimary,
                  flex: 1,
                  background: C.coral,
                  color: "#2B0B06",
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? "Deleting…" : "Yes, delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError("");
                }}
                style={{ ...btnGhost, flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

export function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const res = await api.forgotPassword(email);
      setMsg(res.message || "If that email is registered, a reset link has been sent.");
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Reset password" subtitle="We'll send a link if the email is registered. In development the link is printed in the server terminal.">
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} required />
        {error && <div style={{ color: C.coral, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {msg && <div style={{ color: C.aqua, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <button type="button" onClick={onBack} style={{ ...btnGhost, marginTop: 12 }}>
        Back to sign in
      </button>
    </Shell>
  );
}

export function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      onDone?.();
    } catch (err) {
      setError(err.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Choose new password" subtitle="Enter a new password for your account (min 6 characters).">
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>New password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} minLength={6} required />
        {error && <div style={{ color: C.coral, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </Shell>
  );
}

export function AcceptInviteScreen({ token, onSuccess }) {
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.fetchInvitePreview(token)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Invalid invite");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.acceptInvite(token, { name, password });
      api.setToken(result.token);
      if (result.org) api.setSelectedOrgId(result.org.id);
      onSuccess(result);
    } catch (err) {
      setError(err.message || "Could not accept invite");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell title="Invite" subtitle="Loading…">
        <div style={{ color: C.mute, fontSize: 14 }}>Checking invite…</div>
      </Shell>
    );
  }

  if (!preview) {
    return (
      <Shell title="Invite unavailable" subtitle={error || "This invite link is invalid or expired."}>
        <div style={{ color: C.mute, fontSize: 13 }}>Ask the factory owner to send a new invite.</div>
      </Shell>
    );
  }

  return (
    <Shell
      title={`Join ${preview.orgName}`}
      subtitle={`Invited as ${preview.role} · ${preview.email}`}
    >
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} required />
        <label style={{ display: "block", fontSize: 12, color: C.mute, marginBottom: 6 }}>Create password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} minLength={6} required />
        {error && <div style={{ color: C.coral, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Joining…" : "Accept invite"}
        </button>
      </form>
    </Shell>
  );
}
