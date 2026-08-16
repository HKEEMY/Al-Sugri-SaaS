import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import {
  Droplet, Wallet, Truck, LayoutDashboard,
  Plus, AlertTriangle, Download,
  ChevronRight, X, Check, Users, Boxes, Factory, Trash2, Settings
} from "lucide-react";
import * as api from "./api.js";
import { LoginScreen, SignupScreen, OrgPicker, ForgotPasswordScreen, ResetPasswordScreen, AcceptInviteScreen } from "./AuthScreens.jsx";
import { BrandSetup, BrandingSettings, themeFromBranding, DEFAULT_BRANDING } from "./BrandSetup.jsx";
import { NotificationBell, TeamInvitesPanel } from "./Notifications.jsx";

// ---------- Design tokens ----------
const C = {
  bg: "#0B1E2C",
  panel: "#122B3D",
  panel2: "#173347",
  line: "#20465F",
  aqua: "#2FD8C7",
  aquaDim: "#1B8F84",
  amber: "#F0A83E",
  coral: "#E8604C",
  text: "#EAF3F5",
  mute: "#84A2B0",
};

const CURRENCY = "GH₵";
const POLL_MS = 5000;

const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const money = (n) => `${CURRENCY}${fmt(n)}`;

const emptyDB = () => ({
  inventory: { emptyBags: 0, finishedBags: 0 },
  koyos: ["Koyo 1", "Koyo 2"],
  intake: [],
  rolls: [],
  production: [],
  expenses: [],
  salesFactory: [],
  salesMobile: [],
  sellers: [],
});

function rawStockKg(db) {
  return sum(db.rolls || [], (r) => r.remainingKg);
}

const CATEGORIES = ["Electricity", "Machine repairs", "Tricycle repairs", "Materials", "Miscellaneous", "Other"];

function roleLabel(r) {
  if (!r) return null;
  const m = { owner: "Owner", supervisor: "Supervisor", seller: "Seller" };
  return m[String(r).toLowerCase()] || r;
}

function stripMeta(db) {
  if (!db) return emptyDB();
  const { version, updatedAt, _membership, ...rest } = db;
  return rest;
}

function membershipToOrgPatch(m) {
  if (!m) return null;
  return {
    role: m.role,
    sellerName: m.sellerName,
    name: m.orgName || undefined,
    branding: m.branding,
  };
}

export default function App() {
  const [authView, setAuthView] = useState(() => {
    if (typeof window === "undefined") return "login";
    const q = new URLSearchParams(window.location.search);
    if (q.get("reset")) return "reset";
    if (q.get("invite")) return "invite";
    return "login";
  }); // login | signup | forgot | reset | invite
  const resetToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("reset") : null;
  const inviteToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") : null;

  // Consume the token dropped in the URL hash after a Google/Facebook/X
  // redirect, before the "restore session" effect below reads it.
  useState(() => {
    if (typeof window !== "undefined" && window.location.hash.startsWith("#oauth_token=")) {
      const token = decodeURIComponent(window.location.hash.slice("#oauth_token=".length));
      api.setToken(token);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return null;
  });

  const [session, setSession] = useState(null); // { user, orgs, token }
  const [org, setOrg] = useState(null); // selected org membership object
  const [bootstrapping, setBootstrapping] = useState(true);

  const [db, setDb] = useState(emptyDB);
  const [dbVersion, setDbVersion] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(true);
  const pendingSave = useRef(false);
  const unsynced = useRef(false);
  const dbRef = useRef(db);
  const versionRef = useRef(null);
  const orgIdRef = useRef(null);

  useEffect(() => { dbRef.current = db; }, [db]);
  useEffect(() => { versionRef.current = dbVersion; }, [dbVersion]);
  useEffect(() => { orgIdRef.current = org?.id || null; }, [org]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);

  // Restore session on load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = api.getToken();
      if (!token) {
        setBootstrapping(false);
        return;
      }
      try {
        const me = await api.fetchMe();
        if (cancelled) return;
        setSession({ user: me.user, orgs: me.orgs, token });
        const savedOrgId = api.getSelectedOrgId();
        const match = me.orgs.find((o) => o.id === savedOrgId) || (me.orgs.length === 1 ? me.orgs[0] : null);
        if (match) {
          api.setSelectedOrgId(match.id);
          setOrg(match);
        }
      } catch {
        api.clearSession();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load / sync org data when org is selected
  useEffect(() => {
    if (!org?.id) return;
    let cancelled = false;
    const orgId = org.id;
    const cached = api.loadCachedDB(orgId);
    if (cached) {
      setDb(stripMeta(cached));
      setDbVersion(cached.version ?? api.getCachedVersion(orgId));
    }
    unsynced.current = api.isDirty(orgId);

    (async () => {
      if (unsynced.current && cached) {
        try {
          const saved = await api.pushOrgDB(orgId, { ...stripMeta(cached), version: cached.version ?? api.getCachedVersion(orgId) });
          if (cancelled) return;
          const clean = stripMeta(saved);
          api.cacheDB(orgId, saved);
          api.setDirty(orgId, false);
          unsynced.current = false;
          setDb(clean);
          setDbVersion(saved.version);
          setOnline(true);
          if (saved._membership) {
            const p = membershipToOrgPatch(saved._membership);
            setOrg((o) => o && o.id === orgId ? { ...o, ...p, name: p.name || o.name } : o);
          }
        } catch (err) {
          if (err.status === 409) {
            // server won — pull
            try {
              const serverDB = await api.fetchOrgDB(orgId);
              if (cancelled) return;
              api.cacheDB(orgId, serverDB);
              api.setDirty(orgId, false);
              unsynced.current = false;
              setDb(stripMeta(serverDB));
              setDbVersion(serverDB.version);
              setOnline(true);
              showToast("Server had newer data — loaded latest");
            } catch {
              setOnline(false);
            }
          } else {
            setOnline(false);
          }
        }
        return;
      }
      try {
        const serverDB = await api.fetchOrgDB(orgId);
        if (cancelled) return;
        api.cacheDB(orgId, serverDB);
        setDb(stripMeta(serverDB));
        setDbVersion(serverDB.version);
        setOnline(true);
        if (serverDB._membership) {
          const p = membershipToOrgPatch(serverDB._membership);
          setOrg((o) => o && o.id === orgId ? { ...o, ...p, name: p.name || o.name } : o);
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
    })();
    return () => { cancelled = true; };
  }, [org?.id, showToast]);

  // Poll
  useEffect(() => {
    if (!org?.id) return;
    const interval = setInterval(async () => {
      const orgId = orgIdRef.current;
      if (!orgId || pendingSave.current) return;
      if (unsynced.current) {
        pendingSave.current = true;
        try {
          const saved = await api.pushOrgDB(orgId, { ...dbRef.current, version: versionRef.current });
          api.cacheDB(orgId, saved);
          api.setDirty(orgId, false);
          unsynced.current = false;
          setDb(stripMeta(saved));
          setDbVersion(saved.version);
          setOnline(true);
        } catch (err) {
          if (err.status === 409) {
            try {
              const serverDB = await api.fetchOrgDB(orgId);
              api.cacheDB(orgId, serverDB);
              api.setDirty(orgId, false);
              unsynced.current = false;
              setDb(stripMeta(serverDB));
              setDbVersion(serverDB.version);
              setOnline(true);
            } catch {
              setOnline(false);
            }
          } else {
            setOnline(false);
          }
        } finally {
          pendingSave.current = false;
        }
        return;
      }
      try {
        const serverDB = await api.fetchOrgDB(orgId);
        setOnline(true);
        setDb((current) => {
          const clean = stripMeta(serverDB);
          if (JSON.stringify(clean) === JSON.stringify(current) && serverDB.version === versionRef.current) return current;
          api.cacheDB(orgId, serverDB);
          setDbVersion(serverDB.version);
          return clean;
        });
      } catch {
        setOnline(false);
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [org?.id]);

  const save = useCallback((next) => {
    const orgId = orgIdRef.current;
    if (!orgId) return;
    setDb(next);
    const payload = { ...next, version: versionRef.current };
    api.cacheDB(orgId, payload);
    api.setDirty(orgId, true);
    unsynced.current = true;
    pendingSave.current = true;
    api.pushOrgDB(orgId, payload)
      .then((saved) => {
        api.cacheDB(orgId, saved);
        api.setDirty(orgId, false);
        unsynced.current = false;
        setDb(stripMeta(saved));
        setDbVersion(saved.version);
        setOnline(true);
      })
      .catch((err) => {
        if (err.status === 409 || (err.status >= 400 && err.status < 500)) {
          api.fetchOrgDB(orgId).then((serverDB) => {
            api.cacheDB(orgId, serverDB);
            api.setDirty(orgId, false);
            unsynced.current = false;
            setDb(stripMeta(serverDB));
            setDbVersion(serverDB.version);
            setOnline(true);
            showToast(err.status === 409
              ? "Conflict — loaded latest from server. Re-apply your change."
              : (err.message || "Change rejected by the server."));
          }).catch(() => {
            setOnline(false);
            showToast(err.message || "Change rejected by the server.");
          });
        } else {
          setOnline(false);
          showToast("Saved on this device — will sync when online");
        }
      })
      .finally(() => {
        pendingSave.current = false;
      });
  }, [showToast]);

  const handleAuthSuccess = (result) => {
    if (result.org) {
      // signup
      setSession({ user: result.user, orgs: [result.org], token: result.token });
      setOrg(result.org);
      api.setSelectedOrgId(result.org.id);
    } else {
      // login
      setSession({ user: result.user, orgs: result.orgs, token: result.token });
      if (result.orgs.length === 1) {
        setOrg(result.orgs[0]);
        api.setSelectedOrgId(result.orgs[0].id);
      } else {
        setOrg(null);
      }
    }
  };

  const handleLogout = () => {
    api.clearSession();
    setSession(null);
    setOrg(null);
    setDb(emptyDB());
    setDbVersion(null);
    setAuthView("login");
  };

  const handleSelectOrg = (o) => {
    api.setSelectedOrgId(o.id);
    setOrg(o);
  };

  const handleCreateOrg = (o) => {
    setSession((s) => s ? { ...s, orgs: [...(s.orgs || []), o] } : s);
    api.setSelectedOrgId(o.id);
    setOrg(o);
  };

  if (bootstrapping) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", color: C.mute, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter,sans-serif" }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    if (authView === "signup") {
      return <SignupScreen onSuccess={handleAuthSuccess} onSwitchToLogin={() => setAuthView("login")} />;
    }
    if (authView === "forgot") {
      return <ForgotPasswordScreen onBack={() => setAuthView("login")} />;
    }
    if (authView === "reset" && resetToken) {
      return (
        <ResetPasswordScreen
          token={resetToken}
          onDone={() => {
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete("reset");
              window.history.replaceState({}, "", url.pathname);
            } catch {}
            setAuthView("login");
            showToast("Password updated — sign in");
          }}
        />
      );
    }
    if (authView === "invite" && inviteToken) {
      return (
        <AcceptInviteScreen
          token={inviteToken}
          onSuccess={(result) => {
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete("invite");
              window.history.replaceState({}, "", url.pathname);
            } catch {}
            handleAuthSuccess(result);
          }}
        />
      );
    }
    return (
      <LoginScreen
        onSuccess={handleAuthSuccess}
        onSwitchToSignup={() => setAuthView("signup")}
        onForgot={() => setAuthView("forgot")}
      />
    );
  }

  if (!org) {
    return (
      <OrgPicker
        user={session.user}
        orgs={session.orgs || []}
        onSelect={handleSelectOrg}
        onCreate={handleCreateOrg}
        onLogout={handleLogout}
        onAccountDeleted={handleLogout}
      />
    );
  }

  const role = roleLabel(org.role);
  const sellerName = org.sellerName || "";
  const branding = { ...DEFAULT_BRANDING, ...(org.branding || {}) };
  // Apply brand colours to the shared design tokens so every screen picks them up.
  Object.assign(C, themeFromBranding(branding));

  const needsSetup =
    !branding.setupComplete &&
    (String(org.role).toLowerCase() === "owner" || String(org.role).toLowerCase() === "supervisor");

  if (needsSetup) {
    return (
      <BrandSetup
        org={org}
        user={session.user}
        onComplete={(nextOrg) => {
          setOrg(nextOrg);
          setSession((s) => {
            if (!s) return s;
            return {
              ...s,
              orgs: (s.orgs || []).map((o) => (o.id === nextOrg.id ? { ...o, ...nextOrg } : o)),
            };
          });
        }}
        onSkip={(nextOrg) => {
          if (nextOrg) setOrg(nextOrg);
        }}
      />
    );
  }

  return (
    <Shell
      db={db}
      save={save}
      tab={tab}
      setTab={setTab}
      role={role}
      sellerName={sellerName}
      toast={toast}
      showToast={showToast}
      online={online}
      orgName={org.name}
      org={org}
      userName={session.user?.name}
      onSwitchOrg={() => setOrg(null)}
      onLogout={handleLogout}
      onOrgUpdated={(nextOrg) => {
        setOrg(nextOrg);
        setSession((s) => {
          if (!s) return s;
          return {
            ...s,
            orgs: (s.orgs || []).map((o) => (o.id === nextOrg.id ? { ...o, ...nextOrg } : o)),
          };
        });
      }}
    />
  );
}


const inputStyle = {
  background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "13px 14px",
  color: C.text, fontSize: 16, fontFamily: "'Inter',sans-serif", outline: "none", width: "100%", boxSizing: "border-box",
  minHeight: 46,
};

function KoyoSettings({ db, save, showToast }) {
  const [name, setName] = useState("");
  const koyos = getKoyos(db);

  const addKoyo = () => {
    const clean = name.trim();
    if (!clean) return showToast("Enter a Koyo name");
    if (koyos.some((k) => k.toLowerCase() === clean.toLowerCase())) return showToast("That Koyo already exists");
    save({ ...db, koyos: [...koyos, clean] });
    setName("");
    showToast(`${clean} added`);
  };

  const removeKoyo = (koyo) => {
    const usedByRoll = db.rolls.some((r) => r.row === koyo);
    const usedByProduction = db.production.some((p) => p.koyo === koyo);
    if (usedByRoll || usedByProduction) {
      return showToast(`${koyo} cannot be removed because it is used by existing records`);
    }
    if (koyos.length <= 1) return showToast("Keep at least one Koyo");
    save({ ...db, koyos: koyos.filter((k) => k !== koyo) });
    showToast(`${koyo} removed`);
  };

  return (
    <Card title="Koyo management">
      <div style={{ fontSize: 13, color: C.mute, lineHeight: 1.5, marginBottom: 12 }}>
        Add as many Koyos as this factory operates. A Koyo must have an assigned active roll before production can be recorded.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Koyo 3" style={{ ...inputStyle, flex: "1 1 220px" }} />
        <button onClick={addKoyo} style={ghostBtn}><Plus size={15} /> Add Koyo</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {koyos.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px" }}>
            <span>{k}</span>
            <button onClick={() => removeKoyo(k)} title={`Remove ${k}`} style={{ ...ghostBtn, padding: 6, color: C.mute }}><X size={14} /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ================= Shell =================
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["Owner", "Supervisor"] },
  { id: "inventory", label: "Inventory", icon: Boxes, roles: ["Owner", "Supervisor"] },
  { id: "production", label: "Production", icon: Factory, roles: ["Owner", "Supervisor"] },
  { id: "expenses", label: "Expenses", icon: Wallet, roles: ["Owner", "Supervisor"] },
  { id: "sales", label: "Sales", icon: Truck, roles: ["Owner", "Supervisor", "Seller"] },
  { id: "sellers", label: "Sellers", icon: Users, roles: ["Owner"] },
  { id: "settings", label: "Settings", icon: Settings, roles: ["Owner", "Supervisor"] },
];

function Shell({ db, save, tab, setTab, role, sellerName, toast, showToast, online, orgName, org, userName, onSwitchOrg, onLogout, onOrgUpdated }) {
  const visibleNav = NAV.filter((n) => n.roles.includes(role));
  useEffect(() => {
    if (!visibleNav.find((n) => n.id === tab)) setTab(visibleNav[0]?.id || "sales");
  }, []); // eslint-disable-line

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter',sans-serif", paddingBottom: 84 }}>
      <style>{`
        * { box-sizing: border-box; }
        input, select, textarea { font-family: 'Inter', sans-serif; }
        ::placeholder { color: ${C.mute}; opacity: .7; }
        table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
        th { text-align: left; color: ${C.mute}; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 8px 10px; border-bottom: 1px solid ${C.line}; white-space: nowrap; }
        td { padding: 9px 10px; border-bottom: 1px solid ${C.line}; white-space: nowrap; }
        .table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${C.aqua}; outline-offset: 1px; }
        button { -webkit-tap-highlight-color: transparent; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      <header style={{ padding: "18px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1100, margin: "0 auto", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: C.panel, border: `1px solid ${C.line}`,
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
          }}>
            {org?.branding?.logo ? (
              <img src={org.branding.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <Droplet size={20} color={C.aqua} />
            )}
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 18, lineHeight: 1.1 }}>{orgName || "Ops"}</div>
            <div style={{ fontSize: 11, color: C.mute }}>Factory ops</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: online ? C.aqua : C.amber }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: online ? C.aqua : C.amber, flexShrink: 0 }} />
            {online ? "Synced" : "Offline"}
          </span>
          <span style={{ fontSize: 12, color: C.mute }}>{role}{role === "Seller" && sellerName ? ` · ${sellerName}` : ""}{userName ? ` · ${userName}` : ""}</span>
          {org?.id && <NotificationBell orgId={org.id} colors={C} />}
          <button onClick={onSwitchOrg} style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.mute, borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer", minHeight: 34 }}>Factories</button>
          <button onClick={onLogout} style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.mute, borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer", minHeight: 34 }}>Sign out</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "10px 16px 20px" }}>
        {tab === "dashboard" && <Dashboard db={db} />}
        {tab === "inventory" && <Inventory db={db} save={save} showToast={showToast} />}
        {tab === "production" && <Production db={db} save={save} showToast={showToast} />}
        {tab === "expenses" && <Expenses db={db} save={save} showToast={showToast} />}
        {tab === "sales" && <Sales db={db} save={save} role={role} sellerName={sellerName} showToast={showToast} />}
        {tab === "sellers" && <Sellers db={db} save={save} showToast={showToast} />}
        {tab === "settings" && (
          <>
            <Card title="Branding">
              <BrandingSettings org={org} onSaved={onOrgUpdated} showToast={showToast} />
            </Card>
            {role === "Owner" && (
              <Card title="Team invites">
                <TeamInvitesPanel orgId={org.id} colors={C} showToast={showToast} />
              </Card>
            )}
            <KoyoSettings db={db} save={save} showToast={showToast} />
          </>
        )}
      </main>

      {/* bottom nav (mobile-first, also fine on desktop) */}
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, background: C.panel, borderTop: `1px solid ${C.line}`,
        display: "flex", justifyContent: "space-around", padding: "6px 4px calc(6px + env(safe-area-inset-bottom))", zIndex: 10,
      }}>
        {visibleNav.map((n) => {
          const Icon = n.icon;
          const active = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{
              background: active ? "rgba(47,216,199,0.12)" : "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 3, color: active ? C.aqua : C.mute, fontSize: 11, padding: "7px 8px",
              borderRadius: 10, minWidth: 56, minHeight: 52, justifyContent: "center", fontWeight: active ? 600 : 400, flex: "1 1 0",
            }}>
              <Icon size={22} />
              {n.label}
            </button>
          );
        })}
      </nav>

      {toast && (
        <div style={{
          position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", background: C.panel2,
          border: `1px solid ${C.aquaDim}`, color: C.text, padding: "9px 16px", borderRadius: 8, fontSize: 13, zIndex: 20,
          maxWidth: "calc(100vw - 32px)", textAlign: "center",
        }}>{toast}</div>
      )}
    </div>
  );
}

// ---------- shared bits ----------
function Card({ title, children, right }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, margin: 0, fontWeight: 600 }}>{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
function Stat({ label, value, sub, tone }) {
  const color = tone === "bad" ? C.coral : tone === "warn" ? C.amber : C.aqua;
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", flex: "1 1 130px", minWidth: 130 }}>
      <div style={{ fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 22, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: C.mute, marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  );
}
function PrimaryBtn({ children, ...props }) {
  return (
    <button {...props} style={{
      background: C.aqua, color: "#06201C", border: "none", borderRadius: 9, padding: "13px 18px",
      fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      width: "100%", minHeight: 48,
      ...(props.style || {}),
    }}>{children}</button>
  );
}
function WarnBanner({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, background: "rgba(232,96,76,0.12)",
      border: `1px solid ${C.coral}`, color: C.text, borderRadius: 10, padding: "11px 14px",
      fontSize: 13, marginBottom: 14,
    }}>
      <AlertTriangle size={18} color={C.coral} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}
function exportCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// helpers over db
function withinDays(dateStr, days) {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}
function sum(arr, fn) { return arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0); }

// ================= Dashboard =================
function Dashboard({ db }) {
  const prod7 = db.production.filter((p) => withinDays(p.date, 7));
  const sf7 = db.salesFactory.filter((s) => withinDays(s.date, 7));
  const sm7 = db.salesMobile.filter((s) => withinDays(s.date, 7));
  const exp7 = db.expenses.filter((e) => withinDays(e.date, 7));

  const bagsProduced7 = sum(prod7, (p) => p.produced);
  const leak7 = sum(prod7, (p) => p.leakage);
  const net7 = sum(prod7, (p) => p.net);
  const revenue7 = sum(sf7, (s) => s.amount) + sum(sm7, (s) => s.actual);
  const outstanding = sum(db.sellers, (s) => s.balance);
  const expTotal7 = sum(exp7, (e) => e.amount);
  const leakPct = bagsProduced7 ? ((leak7 / bagsProduced7) * 100).toFixed(1) : "0.0";

  const days = [...Array(14)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const salesByDay = days.map((d) => {
    const f = sum(db.salesFactory.filter((s) => s.date === d), (s) => s.bags);
    const m = sum(db.salesMobile.filter((s) => s.date === d), (s) => s.bagsTaken);
    return { day: d.slice(5), bags: f + m };
  });

  const breakdown = [
    { name: "Factory gate", value: sum(sf7, (s) => s.bags) },
    { name: "Mobile/tricycle", value: sum(sm7, (s) => s.bagsTaken) },
  ];
  const PIE_COLORS = [C.aqua, C.amber];

  const leakSeries = db.production.slice(-14).map((p) => ({
    day: p.date.slice(5),
    pct: p.produced ? Number(((p.leakage / p.produced) * 100).toFixed(1)) : 0,
  }));

  const sellerRank = [...db.sellers].sort((a, b) => sum(db.salesMobile.filter(s => s.seller === b.name), s => s.bagsTaken) - sum(db.salesMobile.filter(s => s.seller === a.name), s => s.bagsTaken));
  const sellersOwing = db.sellers.filter((s) => s.balance > 0);

  return (
    <div>
      {sellersOwing.length > 0 && (
        <WarnBanner>
          {sellersOwing.length} seller{sellersOwing.length > 1 ? "s" : ""} owe{sellersOwing.length === 1 ? "s" : ""} a combined {money(outstanding)}.
        </WarnBanner>
      )}

      <Card title="This week">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Stat label="Bags produced" value={fmt(bagsProduced7)} sub={`net sellable ${fmt(net7)}`} />
          <Stat label="Leakage" value={`${leakPct}%`} tone={leakPct > 8 ? "bad" : leakPct > 4 ? "warn" : undefined} />
          <Stat label="Revenue" value={money(revenue7)} />
          <Stat label="Expenses" value={money(expTotal7)} tone={expTotal7 > revenue7 ? "bad" : undefined} />
          <Stat label="Net position" value={money(revenue7 - expTotal7)} tone={revenue7 - expTotal7 < 0 ? "bad" : undefined} />
          <Stat label="Outstanding (sellers)" value={money(outstanding)} tone={outstanding > 0 ? "warn" : undefined} />
        </div>
      </Card>

      <Card title="Stock levels">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Stat label="Raw material" value={`${fmt(rawStockKg(db))} kg`} sub={`${db.rolls.filter(r => r.remainingKg > 0).length} roll(s) on hand`} />
          <Stat label="Packaging bags" value={fmt(db.inventory.emptyBags)} />
          <Stat label="Remaining stock" value={fmt(db.inventory.finishedBags)} tone={db.inventory.finishedBags < 50 ? "warn" : undefined} />
        </div>
      </Card>

      <Card title="Daily sales — last 14 days">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={salesByDay}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="day" stroke={C.mute} fontSize={11} />
            <YAxis stroke={C.mute} fontSize={11} />
            <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="bags" fill={C.aqua} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <Card title="Sales mix (7d)">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={3}>
                  {breakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <Card title="Leakage % — recent production runs">
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={leakSeries}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="day" stroke={C.mute} fontSize={11} />
                <YAxis stroke={C.mute} fontSize={11} unit="%" />
                <Tooltip contentStyle={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="pct" stroke={C.amber} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>

      <Card title="Seller performance (all-time bags moved)">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Seller</th><th>Bags taken</th><th>Outstanding</th></tr></thead>
            <tbody>
              {sellerRank.length === 0 && <tr><td colSpan={3} style={{ color: C.mute }}>No sellers yet.</td></tr>}
              {sellerRank.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{fmt(sum(db.salesMobile.filter(m => m.seller === s.name), m => m.bagsTaken))}</td>
                  <td style={{ color: s.balance > 0 ? C.coral : C.text }}>{money(s.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ================= Inventory =================
function Inventory({ db, save, showToast }) {
  const [rows, setRows] = useState([{ weight: "" }]);
  const [material, setMaterial] = useState("Raw water");
  const [date, setDate] = useState(todayStr());
  const [receiveBags, setReceiveBags] = useState("");
  const [adjBags, setAdjBags] = useState({ empty: "", finished: "" });

  const totalKg = sum(rows, (r) => r.weight);

  const addIntake = () => {
    const validRows = rows.filter((r) => (Number(r.weight) || 0) > 0);
    if (!validRows.length) return showToast("Enter at least one weight");
    const newRolls = validRows.map((r) => ({
      id: uid(),
      label: `${material || "Roll"} · ${fmt(Number(r.weight))}kg`,
      material,
      row: "",
      loadedKg: Number(r.weight),
      remainingKg: Number(r.weight),
      dateLoaded: date,
    }));
    const kg = sum(newRolls, (r) => r.loadedKg);
    const entry = { id: uid(), date, type: "Raw material", material, quantity: kg, unit: "kg", rollIds: newRolls.map((r) => r.id) };
    save({ ...db, intake: [entry, ...db.intake], rolls: [...newRolls, ...db.rolls] });
    setRows([{ weight: "" }]);
    showToast(`Logged ${newRolls.length} roll${newRolls.length > 1 ? "s" : ""} · ${fmt(kg)} kg total`);
  };

  const receiveEmptyBags = () => {
    const n = Number(receiveBags) || 0;
    if (!n) return showToast("Enter how many bags were received");
    const entry = { id: uid(), date: todayStr(), type: "Packaging bags", material: "", quantity: n, unit: "bags" };
    save({
      ...db,
      intake: [entry, ...db.intake],
      inventory: { ...db.inventory, emptyBags: db.inventory.emptyBags + n },
    });
    setReceiveBags("");
    showToast(`Received ${fmt(n)} packaging bags`);
  };

  const deleteIntake = (entry) => {
    if ((entry.type === "Packaging bags" || entry.type === "Empty bags")) {
      save({
        ...db,
        intake: db.intake.filter((r) => r.id !== entry.id),
        inventory: { ...db.inventory, emptyBags: Math.max(0, db.inventory.emptyBags - entry.quantity) },
      });
      showToast("Entry deleted, packaging-bag count reversed");
      return;
    }
    // Raw material: only remove the rolls it created if none of them have
    // been touched yet (remainingKg still equals loadedKg). If any of that
    // material has already gone into production, removing the roll would
    // silently erase real production history — so only the log line comes
    // off, and the rolls stay for the owner to sort out manually.
    const linkedRolls = db.rolls.filter((r) => (entry.rollIds || []).includes(r.id));
    const untouched = linkedRolls.length > 0 && linkedRolls.every((r) => r.remainingKg === r.loadedKg);
    if (untouched) {
      const rollIdSet = new Set(entry.rollIds);
      save({
        ...db,
        intake: db.intake.filter((r) => r.id !== entry.id),
        rolls: db.rolls.filter((r) => !rollIdSet.has(r.id)),
      });
      showToast("Entry and its roll(s) deleted");
    } else {
      save({ ...db, intake: db.intake.filter((r) => r.id !== entry.id) });
      showToast("Log entry deleted — some of this material was already used, so its roll record was left as-is");
    }
  };

  const applyAdj = () => {
    const e = Number(adjBags.empty) || 0;
    const f = Number(adjBags.finished) || 0;
    if (!e && !f) return;
    save({ ...db, inventory: { ...db.inventory, emptyBags: db.inventory.emptyBags + e, finishedBags: db.inventory.finishedBags + f } });
    setAdjBags({ empty: "", finished: "" });
    showToast("Stock adjusted");
  };

  const activeRolls = [...db.rolls].filter((r) => r.remainingKg > 0).sort((a, b) => b.remainingKg - a.remainingKg);

  return (
    <div>
      <Card title="Current stock">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Stat label="Raw material" value={`${fmt(rawStockKg(db))} kg`} sub={`${activeRolls.length} roll(s) on hand`} />
          <Stat label="Packaging bags" value={fmt(db.inventory.emptyBags)} />
          <Stat label="Finished (sellable)" value={fmt(db.inventory.finishedBags)} />
        </div>
      </Card>

      <Card title="Rolls on hand" right={<span style={{ fontSize: 11, color: C.mute }}>cross-check against physical rolls</span>}>
        {activeRolls.length === 0 && <div style={{ color: C.mute, fontSize: 13 }}>No rolls in stock. Log an intake below.</div>}
        {activeRolls.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activeRolls.map((r) => (
              <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
                <div style={{ color: C.aqua, fontWeight: 600 }}>{fmt(r.remainingKg)} kg</div>
                <div style={{ fontSize: 10, color: C.mute }}>{r.row ? `on ${r.row}` : "not yet on a line"}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.mute, marginTop: 10 }}>Each card is one physical roll. A roll drops off this list the moment it's fully used in Production — that's your confirmation it's finished.</div>
      </Card>

      <Card title="Record raw material intake">
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Material">
          <input value={material} onChange={(e) => setMaterial(e.target.value)} style={inputStyle} placeholder="e.g. Raw water, nylon roll" />
        </Field>
        <div style={{ fontSize: 12, color: C.mute, marginBottom: 6 }}>Weights (kg) — one row per physical roll/bag/delivery. Each row becomes its own tracked roll.</div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="number" placeholder="kg" value={r.weight}
              onChange={(e) => setRows(rows.map((x, xi) => xi === i ? { weight: e.target.value } : x))}
              style={{ ...inputStyle }}
            />
            {rows.length > 1 && (
              <button onClick={() => setRows(rows.filter((_, xi) => xi !== i))} style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", minWidth: 40 }}><X size={16} /></button>
            )}
          </div>
        ))}
        <button onClick={() => setRows([...rows, { weight: "" }])} style={{ background: "none", border: `1px dashed ${C.line}`, color: C.aqua, borderRadius: 8, padding: "10px 12px", fontSize: 13, cursor: "pointer", marginBottom: 12, width: "100%", minHeight: 44 }}>
          + add row
        </button>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: C.aqua, marginBottom: 12 }}>Total: {fmt(totalKg)} kg</div>
        <PrimaryBtn onClick={addIntake}><Plus size={16} /> Log intake</PrimaryBtn>
      </Card>

      <Card title="Receive packaging bags">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px" }}>
            <Field label="Bags received">
              <input type="number" value={receiveBags} onChange={(e) => setReceiveBags(e.target.value)} style={inputStyle} placeholder="e.g. 500" />
            </Field>
          </div>
        </div>
        <PrimaryBtn onClick={receiveEmptyBags}><Plus size={16} /> Receive bags</PrimaryBtn>
      </Card>

      <Card title="Manual stock correction" right={<span style={{ fontSize: 11, color: C.mute }}>use for mistakes only</span>}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Packaging bags (+/-)"><input type="number" value={adjBags.empty} onChange={(e) => setAdjBags({ ...adjBags, empty: e.target.value })} style={inputStyle} /></Field>
          <Field label="Finished bags (+/-)"><input type="number" value={adjBags.finished} onChange={(e) => setAdjBags({ ...adjBags, finished: e.target.value })} style={inputStyle} /></Field>
        </div>
        <PrimaryBtn onClick={applyAdj}><Check size={16} /> Apply correction</PrimaryBtn>
      </Card>

      <Card title="Intake log" right={<button onClick={() => exportCSV("intake.csv", db.intake)} style={ghostBtn}><Download size={14} /> CSV</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Material</th><th>Quantity</th><th></th></tr></thead>
            <tbody>
              {db.intake.slice(0, 15).map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td><td>{r.type}</td><td>{r.material || "—"}</td><td>{fmt(r.quantity)} {r.unit}</td>
                  <td><DeleteBtn onConfirm={() => deleteIntake(r)} confirmMsg="Delete this intake entry? This will reverse its effect on stock where it's still safe to do so." /></td>
                </tr>
              ))}
              {db.intake.length === 0 && <tr><td colSpan={5} style={{ color: C.mute }}>No entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
const ghostBtn = { background: "none", border: `1px solid ${C.line}`, color: C.mute, borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, minHeight: 34 };

// Deletes here reverse whatever stock/balance effect the entry caused, so
// every one of them asks for confirmation first — not just a stray click.
function DeleteBtn({ onConfirm, confirmMsg }) {
  return (
    <button
      onClick={() => { if (window.confirm(confirmMsg || "Delete this entry? This will undo its effect on stock.")) onConfirm(); }}
      title="Delete entry"
      style={{ background: "none", border: "none", color: C.mute, cursor: "pointer", padding: 6, display: "flex", alignItems: "center", minHeight: 32, minWidth: 32, justifyContent: "center" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = C.coral; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = C.mute; }}
    >
      <Trash2 size={15} />
    </button>
  );
}

// Koyos are organization-specific. Older workspaces are migrated to the
// default Koyo 1 / Koyo 2 list by the server and by the UI fallback below.
function getKoyos(db) {
  const list = Array.isArray(db?.koyos) ? db.koyos : [];
  return list.length ? list : ["Koyo 1", "Koyo 2"];
}

function Production({ db, save, showToast }) {
  const koyos = getKoyos(db);
  const [f, setF] = useState({ date: todayStr(), koyo: "", rollId: "", rawUsedKg: "", produced: "", leakage: "" });
  const [assignKoyo, setAssignKoyo] = useState({});

  const net = Math.max(0, (Number(f.produced) || 0) - (Number(f.leakage) || 0));
  const activeRolls = db.rolls.filter((r) => r.remainingKg > 0);
  const onKoyoRolls = activeRolls.filter((r) => r.row);
  const inStockRolls = activeRolls.filter((r) => !r.row);
  const selectedRoll = db.rolls.find((r) => r.id === f.rollId);
  const selectedKoyoRoll = db.rolls.find((r) => r.row === f.koyo && r.remainingKg > 0);
  const availablePackaging = Number(db.inventory?.emptyBags) || 0;

  useEffect(() => {
    setF((current) => ({ ...current, date: todayStr() }));
  }, []);

  const assignToKoyo = (rollId) => {
    const koyo = assignKoyo[rollId] || "";
    if (!koyo) return showToast("Pick which Koyo this roll is going on");
    save({ ...db, rolls: db.rolls.map((r) => r.id === rollId ? { ...r, row: koyo } : r) });
    setAssignKoyo({ ...assignKoyo, [rollId]: "" });
    showToast(`Roll assigned to ${koyo}`);
  };

  const submit = () => {
    const rawUsed = Number(f.rawUsedKg);
    const produced = Number(f.produced);
    const leakage = Number(f.leakage);

    if (!f.koyo) return showToast("Select a Koyo before recording production");
    if (!f.rollId) return showToast("Assign a roll to the selected Koyo before recording production");
    if (!selectedRoll) return showToast("Selected roll could not be found");
    if (selectedRoll.row !== f.koyo) return showToast("The selected roll is not assigned to this Koyo");
    if (!(produced > 0)) return showToast("Enter bags produced");
    if (!(rawUsed > 0)) return showToast("Enter raw material used");
    if (!(leakage >= 0 && leakage <= produced)) return showToast("Leakages/rejects must be between 0 and bags produced");
    if (produced > availablePackaging) {
      return showToast(`Production blocked: only ${fmt(availablePackaging)} packaging bags are available`);
    }
    if (rawUsed > (Number(selectedRoll.remainingKg) || 0)) {
      return showToast(`Production blocked: selected roll has only ${fmt(selectedRoll.remainingKg)} kg remaining`);
    }

    const entry = {
      id: uid(),
      date: todayStr(),
      koyo: f.koyo,
      rollId: f.rollId,
      rollLabel: selectedRoll.label || "",
      rawUsedKg: rawUsed,
      produced,
      leakage,
      net: produced - leakage,
    };

    const rolls = db.rolls.map((r) =>
      r.id === f.rollId ? { ...r, remainingKg: r.remainingKg - rawUsed } : r
    );

    const next = {
      ...db,
      production: [entry, ...db.production],
      rolls,
      inventory: {
        ...db.inventory,
        emptyBags: availablePackaging - produced,
        finishedBags: (Number(db.inventory?.finishedBags) || 0) + (produced - leakage),
      },
    };

    save(next);
    setF({ date: todayStr(), koyo: f.koyo, rollId: f.rollId, rawUsedKg: "", produced: "", leakage: "" });
    showToast(`Logged: ${fmt(produced - leakage)} sellable bags`);
  };

  const deleteRun = (entry) => {
    const isToday = entry.date === todayStr();
    if (!isToday) {
      return showToast("Historical production cannot be deleted from this screen");
    }
    const rolls = entry.rollId
      ? db.rolls.map((r) => r.id === entry.rollId ? { ...r, remainingKg: Math.min(r.loadedKg, r.remainingKg + entry.rawUsedKg) } : r)
      : db.rolls;
    save({
      ...db,
      production: db.production.filter((p) => p.id !== entry.id),
      rolls,
      inventory: {
        ...db.inventory,
        emptyBags: db.inventory.emptyBags + entry.produced,
        finishedBags: Math.max(0, db.inventory.finishedBags - entry.net),
      },
    });
    showToast("Run deleted — stock reversed");
  };

  return (
    <div>
      {inStockRolls.length > 0 && (
        <Card title="Rolls in stock — not yet on a Koyo">
          {inStockRolls.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, color: C.aqua, flex: "0 0 auto" }}>{fmt(r.remainingKg)} kg</div>
              <select value={assignKoyo[r.id] || ""} onChange={(e) => setAssignKoyo({ ...assignKoyo, [r.id]: e.target.value })} style={{ ...inputStyle, flex: "1 1 140px" }}>
                <option value="">Pick a Koyo</option>
                {koyos.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button onClick={() => assignToKoyo(r.id)} style={ghostBtn}>Assign</button>
            </div>
          ))}
        </Card>
      )}

      <Card title="Rolls on a Koyo" right={<span style={{ fontSize: 11, color: C.mute }}>carries over day to day</span>}>
        {onKoyoRolls.length === 0 && <div style={{ color: C.mute, fontSize: 13, marginBottom: 12 }}>No roll currently loaded on a Koyo.</div>}
        {onKoyoRolls.map((r) => (
          <div key={r.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.mute, marginBottom: 4 }}>
              <span>{r.row}</span>
              <span>{fmt(r.remainingKg)} / {fmt(r.loadedKg)} kg left</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.06)", overflow: "hidden", border: `1px solid ${C.line}` }}>
              <div style={{ height: "100%", width: `${r.loadedKg ? (r.remainingKg / r.loadedKg) * 100 : 0}%`, background: C.amber }} />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: C.mute, marginTop: 4 }}>A roll disappears from this list the moment its remaining weight hits zero. Every roll has to come from an Inventory intake entry first.</div>
      </Card>

      <Card title="Log production run">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Date">
            <input type="date" value={todayStr()} readOnly style={{ ...inputStyle, opacity: 0.8 }} />
          </Field>
          <Field label="Koyo">
            <select value={f.koyo} onChange={(e) => {
              const koyo = e.target.value;
              const roll = db.rolls.find((r) => r.row === koyo && r.remainingKg > 0);
              setF({ ...f, koyo, rollId: roll?.id || "" });
            }} style={inputStyle}>
              <option value="">— select —</option>
              {koyos.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Drawing from roll">
          <select value={f.rollId} onChange={(e) => setF({ ...f, rollId: e.target.value })} style={inputStyle} disabled={!f.koyo}>
            <option value="">{f.koyo ? "— select assigned roll —" : "— select Koyo first —"}</option>
            {activeRolls.filter((r) => r.row === f.koyo).map((r) => <option key={r.id} value={r.id}>{fmt(r.remainingKg)} kg left · {r.label}</option>)}
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Raw material used (kg)"><input type="number" min="0" step="0.01" value={f.rawUsedKg} onChange={(e) => setF({ ...f, rawUsedKg: e.target.value })} style={inputStyle} disabled={!f.rollId} /></Field>
          <Field label="Bags produced"><input type="number" min="1" value={f.produced} onChange={(e) => setF({ ...f, produced: e.target.value })} style={inputStyle} disabled={!f.rollId} /></Field>
          <Field label="Leakages / rejects"><input type="number" min="0" value={f.leakage} onChange={(e) => setF({ ...f, leakage: e.target.value })} style={inputStyle} disabled={!f.rollId} /></Field>
        </div>
        {!f.koyo && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Production is unavailable until a Koyo is selected.</div>}
        {f.koyo && !selectedKoyoRoll && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Production is unavailable because {f.koyo} has no active roll assigned.</div>}
        {f.koyo && selectedKoyoRoll && availablePackaging <= 0 && <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>Production is unavailable because there are no packaging bags in inventory.</div>}
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.aqua, marginBottom: 12 }}>Packaging bags available: {fmt(availablePackaging)} · Net sellable: {fmt(net)}</div>
        <PrimaryBtn onClick={submit} disabled={!f.koyo || !f.rollId || availablePackaging <= 0} style={{ opacity: (!f.koyo || !f.rollId || availablePackaging <= 0) ? 0.55 : 1, cursor: (!f.koyo || !f.rollId || availablePackaging <= 0) ? "not-allowed" : "pointer" }}><Plus size={16} /> Log run</PrimaryBtn>
      </Card>

      <Card title="Recent runs" right={<button onClick={() => exportCSV("production.csv", db.production)} style={ghostBtn}><Download size={14} /> CSV</button>}>
        {db.production.slice(0, 8).map((p) => <RowGauge key={p.id} p={p} onDelete={() => deleteRun(p)} />)}
        {db.production.length === 0 && <div style={{ color: C.mute, fontSize: 13 }}>No production logged yet.</div>}
      </Card>
    </div>
  );
}

// Signature element: liquid-fill gauge per run showing sellable vs leakage.
function RowGauge({ p, onDelete }) {
  const total = p.produced || 1;
  const sellablePct = Math.max(0, ((p.produced - p.leakage) / total) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.mute, marginBottom: 4 }}>
        <span>{p.date} · {p.koyo || "no Koyo set"}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {fmt(p.net)} / {fmt(p.produced)} sellable
          <DeleteBtn onConfirm={onDelete} confirmMsg="Delete this run? This will add the bags back to packaging/finished stock and, if it drew from a roll, add the kg back to that roll." />
        </span>
      </div>
      <div style={{ height: 14, borderRadius: 7, background: "rgba(232,96,76,0.28)", overflow: "hidden", border: `1px solid ${C.line}` }}>
        <div style={{ height: "100%", width: `${sellablePct}%`, background: `linear-gradient(90deg, ${C.aquaDim}, ${C.aqua})`, transition: "width .4s" }} />
      </div>

    </div>
  );
}

// ================= Expenses =================
function Expenses({ db, save, showToast }) {
  const [f, setF] = useState({ date: todayStr(), category: CATEGORIES[0], amount: "", desc: "" });

  const submit = () => {
    const amt = Number(f.amount) || 0;
    if (!amt) return showToast("Enter an amount");
    save({ ...db, expenses: [{ id: uid(), ...f, amount: amt }, ...db.expenses] });
    setF({ ...f, amount: "", desc: "" });
    showToast("Expense recorded");
  };

  const today = sum(db.expenses.filter((e) => e.date === todayStr()), (e) => e.amount);
  const week = sum(db.expenses.filter((e) => withinDays(e.date, 7)), (e) => e.amount);
  const month = sum(db.expenses.filter((e) => withinDays(e.date, 30)), (e) => e.amount);
  const salesTotal = sum(db.salesFactory, (s) => s.amount) + sum(db.salesMobile, (s) => s.actual);
  const expTotal = sum(db.expenses, (e) => e.amount);

  return (
    <div>
      <Card title="Totals">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Stat label="Today" value={money(today)} />
          <Stat label="This week" value={money(week)} />
          <Stat label="This month" value={money(month)} />
          <Stat label="Total sales (all-time)" value={money(salesTotal)} />
          <Stat label="Total expenses (all-time)" value={money(expTotal)} tone={expTotal > salesTotal ? "bad" : undefined} />
        </div>
      </Card>

      <Card title="Record expense">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={inputStyle} /></Field>
          <Field label="Category">
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={inputStyle}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={`Amount (${CURRENCY})`}><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={inputStyle} /></Field>
        </div>
        <Field label="Description"><input value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} style={inputStyle} placeholder="What was this for?" /></Field>
        <PrimaryBtn onClick={submit}><Plus size={16} /> Add expense</PrimaryBtn>
      </Card>

      <Card title="Recent expenses" right={<button onClick={() => exportCSV("expenses.csv", db.expenses)} style={ghostBtn}><Download size={14} /> CSV</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Note</th></tr></thead>
            <tbody>
              {db.expenses.slice(0, 15).map((e) => (
                <tr key={e.id}><td>{e.date}</td><td>{e.category}</td><td>{money(e.amount)}</td><td style={{ color: C.mute }}>{e.desc}</td></tr>
              ))}
              {db.expenses.length === 0 && <tr><td colSpan={4} style={{ color: C.mute }}>No expenses yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ================= Sales =================
function Sales({ db, save, role, sellerName, showToast }) {
  const [mode, setMode] = useState(role === "Seller" ? "mobile" : "factory");
  const [fg, setFg] = useState({ date: todayStr(), staff: "", bags: "", unitPrice: "" });
  const [ms, setMs] = useState({ date: todayStr(), seller: sellerName || "", bagsTaken: "", unitPrice: "", actual: "" });

  const fgAmount = (Number(fg.bags) || 0) * (Number(fg.unitPrice) || 0);
  const expected = (Number(ms.bagsTaken) || 0) * (Number(ms.unitPrice) || 0);
  const diff = expected - (Number(ms.actual) || 0);

  const submitFactory = () => {
    const bags = Number(fg.bags) || 0;
    const staff = fg.staff.trim();
    if (!bags) return showToast("Enter bags sold");
    if (!staff) return showToast("Enter who sold it — needed to cross-check the record later");
    if (bags > db.inventory.finishedBags) showToast("⚠ more than stock — check inventory");
    save({
      ...db,
      salesFactory: [{ id: uid(), date: fg.date, staff, bags, unitPrice: Number(fg.unitPrice) || 0, amount: fgAmount }, ...db.salesFactory],
      inventory: { ...db.inventory, finishedBags: db.inventory.finishedBags - bags },
    });
    setFg({ ...fg, bags: "" });
    showToast(`Sold ${bags} bags · ${money(fgAmount)} · by ${staff}`);
  };

  const submitMobile = () => {
    const bags = Number(ms.bagsTaken) || 0;
    const name = ms.seller.trim();
    if (!bags || !name) return showToast("Enter seller and bags taken");
    const entry = { id: uid(), date: ms.date, seller: name, bagsTaken: bags, unitPrice: Number(ms.unitPrice) || 0, expected, actual: Number(ms.actual) || 0, diff };
    let sellers = db.sellers;
    if (!sellers.find((s) => s.name === name)) sellers = [...sellers, { name, balance: 0 }];
    sellers = sellers.map((s) => s.name === name ? { ...s, balance: s.balance + diff } : s);
    save({
      ...db,
      salesMobile: [entry, ...db.salesMobile],
      sellers,
      inventory: { ...db.inventory, finishedBags: db.inventory.finishedBags - bags },
    });
    setMs({ ...ms, bagsTaken: "", actual: "" });
    showToast(diff > 0 ? `Shortage of ${money(diff)} recorded for ${name}` : "Reconciled — fully accounted");
  };

  const deleteFactorySale = (s) => {
    save({
      ...db,
      salesFactory: db.salesFactory.filter((x) => x.id !== s.id),
      inventory: { ...db.inventory, finishedBags: db.inventory.finishedBags + s.bags },
    });
    showToast("Sale deleted, bags added back to stock");
  };

  const deleteMobileSale = (s) => {
    save({
      ...db,
      salesMobile: db.salesMobile.filter((x) => x.id !== s.id),
      sellers: db.sellers.map((sel) => sel.name === s.seller ? { ...sel, balance: sel.balance - s.diff } : sel),
      inventory: { ...db.inventory, finishedBags: db.inventory.finishedBags + s.bagsTaken },
    });
    showToast("Sale deleted, stock and seller balance reversed");
  };

  const myMobile = role === "Seller" ? db.salesMobile.filter((s) => s.seller === sellerName) : db.salesMobile;
  const myBalance = role === "Seller" ? (db.sellers.find((s) => s.name === sellerName)?.balance || 0) : null;

  return (
    <div>
      {role !== "Seller" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setMode("factory")} style={tabBtn(mode === "factory")}>Factory gate</button>
          <button onClick={() => setMode("mobile")} style={tabBtn(mode === "mobile")}>Mobile / tricycle</button>
        </div>
      )}

      {role === "Seller" && myBalance > 0 && (
        <WarnBanner>You owe {money(myBalance)} to the factory.</WarnBanner>
      )}
      {role === "Seller" && (
        <Card title="Your outstanding balance">
          <Stat label={sellerName} value={money(myBalance)} tone={myBalance > 0 ? "warn" : undefined} sub={myBalance > 0 ? "You owe this to the factory" : "Fully reconciled"} />
        </Card>
      )}

      {mode === "factory" && role !== "Seller" && (
        <Card title="Record factory-gate sale">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="Date"><input type="date" value={fg.date} onChange={(e) => setFg({ ...fg, date: e.target.value })} style={inputStyle} /></Field>
            <Field label="Sold by">
              <input value={fg.staff} onChange={(e) => setFg({ ...fg, staff: e.target.value })} style={inputStyle} placeholder="e.g. Baba" />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="Bags sold"><input type="number" value={fg.bags} onChange={(e) => setFg({ ...fg, bags: e.target.value })} style={inputStyle} /></Field>
            <Field label={`Unit price (${CURRENCY})`}><input type="number" value={fg.unitPrice} onChange={(e) => setFg({ ...fg, unitPrice: e.target.value })} style={inputStyle} /></Field>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", color: C.aqua, marginBottom: 12 }}>Amount: {money(fgAmount)}</div>
          <PrimaryBtn onClick={submitFactory}><Plus size={16} /> Record sale</PrimaryBtn>
        </Card>
      )}

      {mode === "mobile" && (
        <Card title="Record mobile/tricycle sale">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="Date"><input type="date" value={ms.date} onChange={(e) => setMs({ ...ms, date: e.target.value })} style={inputStyle} /></Field>
            <Field label="Seller">
              <input value={ms.seller} disabled={role === "Seller"} onChange={(e) => setMs({ ...ms, seller: e.target.value })} style={{ ...inputStyle, opacity: role === "Seller" ? 0.7 : 1 }} placeholder="e.g. Baba" />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="Bags taken"><input type="number" value={ms.bagsTaken} onChange={(e) => setMs({ ...ms, bagsTaken: e.target.value })} style={inputStyle} /></Field>
            <Field label={`Unit price (${CURRENCY})`}><input type="number" value={ms.unitPrice} onChange={(e) => setMs({ ...ms, unitPrice: e.target.value })} style={inputStyle} /></Field>
            <Field label={`Actual cash returned (${CURRENCY})`}><input type="number" value={ms.actual} onChange={(e) => setMs({ ...ms, actual: e.target.value })} style={inputStyle} /></Field>
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ color: C.mute }}>Expected: <b style={{ color: C.text }}>{money(expected)}</b></span>
            <span style={{ color: C.mute }}>Difference: <b style={{ color: diff > 0 ? C.coral : C.aqua }}>{money(diff)}</b></span>
          </div>
          <PrimaryBtn onClick={submitMobile}><Plus size={16} /> Record &amp; reconcile</PrimaryBtn>
        </Card>
      )}

      {mode === "factory" && role !== "Seller" && (
        <Card title="Recent factory-gate sales" right={<button onClick={() => exportCSV("factory-sales.csv", db.salesFactory)} style={ghostBtn}><Download size={14} /> CSV</button>}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Sold by</th><th>Bags</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {db.salesFactory.slice(0, 20).map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td><td>{s.staff || "—"}</td><td>{fmt(s.bags)}</td><td>{money(s.amount)}</td>
                    <td><DeleteBtn onConfirm={() => deleteFactorySale(s)} confirmMsg="Delete this sale? The bags will be added back to finished stock." /></td>
                  </tr>
                ))}
                {db.salesFactory.length === 0 && <tr><td colSpan={5} style={{ color: C.mute }}>No factory-gate sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={role === "Seller" ? "Your sales history" : "Today's reconciliation — mobile sellers"} right={role !== "Seller" && <button onClick={() => exportCSV("mobile-sales.csv", db.salesMobile)} style={ghostBtn}><Download size={14} /> CSV</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Seller</th><th>Bags</th><th>Expected</th><th>Returned</th><th>Diff</th>{role !== "Seller" && <th></th>}</tr></thead>
            <tbody>
              {(role === "Seller" ? myMobile : db.salesMobile.filter((s) => s.date === todayStr())).slice(0, 20).map((s) => (
                <tr key={s.id}>
                  <td>{s.date}</td><td>{s.seller}</td><td>{fmt(s.bagsTaken)}</td>
                  <td>{money(s.expected)}</td><td>{money(s.actual)}</td>
                  <td style={{ color: s.diff > 0 ? C.coral : C.aqua }}>{money(s.diff)}</td>
                  {role !== "Seller" && <td><DeleteBtn onConfirm={() => deleteMobileSale(s)} confirmMsg="Delete this sale? Stock and the seller's balance will both be reversed." /></td>}
                </tr>
              ))}
              {(role === "Seller" ? myMobile.length : db.salesMobile.filter((s) => s.date === todayStr()).length) === 0 && (
                <tr><td colSpan={role === "Seller" ? 6 : 7} style={{ color: C.mute }}>Nothing recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
const tabBtn = (active) => ({
  background: active ? C.aqua : C.panel, color: active ? "#06201C" : C.mute, border: `1px solid ${active ? C.aqua : C.line}`,
  borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer", fontWeight: active ? 600 : 400, flex: "1 1 0", minHeight: 40,
});

// ================= Sellers =================
function Sellers({ db, save, showToast }) {
  const [payment, setPayment] = useState({});
  const sellersOwing = db.sellers.filter((s) => s.balance > 0);

  const recordPayment = (name) => {
    const amt = Number(payment[name]) || 0;
    if (!amt) return;
    save({ ...db, sellers: db.sellers.map((s) => s.name === name ? { ...s, balance: s.balance - amt } : s) });
    setPayment({ ...payment, [name]: "" });
    showToast(`Payment of ${money(amt)} recorded for ${name}`);
  };

  return (
    <div>
      {sellersOwing.length > 0 && (
        <WarnBanner>
          {sellersOwing.map((s) => s.name).join(", ")} {sellersOwing.length > 1 ? "owe" : "owes"} money to the factory.
        </WarnBanner>
      )}

      <Card title="Sellers & outstanding balances">
        {db.sellers.length === 0 && <div style={{ color: C.mute, fontSize: 13 }}>No sellers recorded yet — they appear automatically after their first mobile sale entry.</div>}
        {db.sellers.map((s) => {
          const history = db.salesMobile.filter((m) => m.seller === s.name);
          return (
            <div key={s.name} style={{ borderTop: `1px solid ${C.line}`, padding: "12px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    {s.balance > 0 && <AlertTriangle size={14} color={C.coral} />}
                    {s.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.mute }}>{history.length} trips · {fmt(sum(history, h => h.bagsTaken))} bags total</div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 18, color: s.balance > 0 ? C.coral : C.aqua }}>{money(s.balance)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input type="number" placeholder={`Record payment ${CURRENCY}`} value={payment[s.name] || ""} onChange={(e) => setPayment({ ...payment, [s.name]: e.target.value })} style={{ ...inputStyle, flex: "1 1 160px" }} />
                <button onClick={() => recordPayment(s.name)} style={{ ...ghostBtn, flex: "0 0 auto" }}>Apply</button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
