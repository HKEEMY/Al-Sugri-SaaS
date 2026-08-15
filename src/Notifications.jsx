import React, { useEffect, useState, useRef } from "react";
import { Bell } from "lucide-react";
import * as api from "./api.js";

export function NotificationBell({ orgId, colors: C }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    if (!orgId) return;
    try {
      const res = await api.fetchNotifications(orgId);
      setItems(res.notifications || []);
      setUnread(res.unread || 0);
    } catch {
      /* offline */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [orgId]);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markAll = async () => {
    try {
      await api.markNotificationsRead(orgId, []);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          color: C.text,
          borderRadius: 6,
          padding: "7px 10px",
          cursor: "pointer",
          minHeight: 34,
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              background: C.coral || "#E8604C",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 8,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "110%",
            width: 320,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: 360,
            overflow: "auto",
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            zIndex: 50,
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                style={{
                  background: "none",
                  border: "none",
                  color: C.aqua,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <div style={{ padding: 16, color: C.mute, fontSize: 13 }}>No notifications yet.</div>
          )}
          {items.map((n) => (
            <div
              key={n.id}
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${C.line}`,
                background: n.read ? "transparent" : "rgba(47,216,199,0.06)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 4, lineHeight: 1.4 }}>{n.body}</div>
              <div style={{ fontSize: 10, color: C.mute, marginTop: 6 }}>
                {n.type === "alert" ? "Alert · " : ""}
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TeamInvitesPanel({ orgId, colors: C, showToast }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("supervisor");
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await api.listOrgInvites(orgId);
      setInvites(res.invites || []);
    } catch {
      setInvites([]);
    }
  };

  useEffect(() => {
    load();
  }, [orgId]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createOrgInvite(orgId, { email, role });
      setEmail("");
      showToast?.("Invite sent (check server log for link in dev)");
      load();
    } catch (err) {
      showToast?.(err.message || "Invite failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: C.mute, marginBottom: 12, lineHeight: 1.45 }}>
        Invite supervisors or sellers by email. In development the invite link is printed in the
        server terminal; with SMTP configured it goes to their inbox.
      </div>
      <form onSubmit={send} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <input
          type="email"
          required
          placeholder="colleague@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            flex: "1 1 160px",
            padding: "11px 12px",
            borderRadius: 9,
            border: `1px solid ${C.line}`,
            background: C.bg || C.panel2,
            color: C.text,
            fontSize: 15,
          }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          style={{
            padding: "11px 12px",
            borderRadius: 9,
            border: `1px solid ${C.line}`,
            background: C.bg || C.panel2,
            color: C.text,
            fontSize: 15,
          }}
        >
          <option value="supervisor">Supervisor</option>
          <option value="seller">Seller</option>
          <option value="owner">Owner</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "11px 16px",
            borderRadius: 9,
            border: "none",
            background: C.aqua,
            color: "#06201C",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>
      {invites.length === 0 ? (
        <div style={{ color: C.mute, fontSize: 13 }}>No pending invites.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td style={{ color: i.expired ? C.coral : C.mute }}>
                    {i.expired ? "Expired" : new Date(i.expiresAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
