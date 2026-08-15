import React, { useState, useRef } from "react";
import { Droplet, Upload, Check } from "lucide-react";
import * as api from "./api.js";

export const DEFAULT_BRANDING = {
  logo: null,
  accentColor: "#2FD8C7",
  bgColor: "#0B1E2C",
  panelColor: "#122B3D",
  setupComplete: false,
};

/** Build the design token object used across the app from branding. */
export function themeFromBranding(branding) {
  const b = { ...DEFAULT_BRANDING, ...(branding || {}) };
  const accent = b.accentColor || DEFAULT_BRANDING.accentColor;
  const bg = b.bgColor || DEFAULT_BRANDING.bgColor;
  const panel = b.panelColor || DEFAULT_BRANDING.panelColor;
  return {
    bg,
    panel,
    panel2: panel,
    line: mixToward(panel, "#ffffff", 0.12),
    aqua: accent,
    aquaDim: mixToward(accent, "#000000", 0.35),
    amber: "#F0A83E",
    coral: "#E8604C",
    text: "#EAF3F5",
    mute: mixToward(bg, "#ffffff", 0.45),
    logo: b.logo || null,
    factoryName: b.factoryName || null,
  };
}

function mixToward(hex, toward, amount) {
  try {
    const a = hexToRgb(hex);
    const b = hexToRgb(toward);
    if (!a || !b) return hex;
    const r = Math.round(a.r + (b.r - a.r) * amount);
    const g = Math.round(a.g + (b.g - a.g) * amount);
    const bl = Math.round(a.b + (b.b - a.b) * amount);
    return rgbToHex(r, g, bl);
  } catch {
    return hex;
  }
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
      .join("")
  );
}

const PRESETS = [
  { name: "Aqua industrial", accentColor: "#2FD8C7", bgColor: "#0B1E2C", panelColor: "#122B3D" },
  { name: "Gold on charcoal", accentColor: "#F0A83E", bgColor: "#1A1520", panelColor: "#2A2233" },
  { name: "Forest", accentColor: "#3DDC97", bgColor: "#0D1F17", panelColor: "#143026" },
  { name: "Ocean", accentColor: "#4DA3FF", bgColor: "#0A1628", panelColor: "#12243D" },
  { name: "Berry", accentColor: "#FF6B9D", bgColor: "#1A0F18", panelColor: "#2C1828" },
];

/**
 * Shopify-style first-run setup: logo, factory name polish, brand colors.
 * Shown until setupComplete is true (owner can still skip).
 */
export function BrandSetup({ org, user, onComplete, onSkip }) {
  const branding = { ...DEFAULT_BRANDING, ...(org.branding || {}) };
  const [name, setName] = useState(org.name || "");
  const [logo, setLogo] = useState(branding.logo);
  const [accentColor, setAccentColor] = useState(branding.accentColor);
  const [bgColor, setBgColor] = useState(branding.bgColor);
  const [panelColor, setPanelColor] = useState(branding.panelColor);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const preview = themeFromBranding({ logo, accentColor, bgColor, panelColor });

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG, or SVG).");
      return;
    }
    if (file.size > 600_000) {
      setError("Image is too large. Please use a logo under 600KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(String(reader.result));
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const applyPreset = (p) => {
    setAccentColor(p.accentColor);
    setBgColor(p.bgColor);
    setPanelColor(p.panelColor);
  };

  const save = async (complete) => {
    setError("");
    setBusy(true);
    try {
      const updated = await api.updateOrgBranding(org.id, {
        name: name.trim() || org.name,
        logo,
        accentColor,
        bgColor,
        panelColor,
        setupComplete: complete,
      });
      onComplete({
        ...org,
        name: updated.name,
        branding: updated.branding,
      });
    } catch (err) {
      setError(err.message || "Could not save branding");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: preview.bg,
        color: preview.text,
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "24px 16px 40px",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: preview.panel,
              border: `1px solid ${preview.line}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              overflow: "hidden",
            }}
          >
            {logo ? (
              <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <Droplet size={28} color={preview.aqua} />
            )}
          </div>
          <h1 style={{ margin: 0, fontFamily: "Space Grotesk, Inter, sans-serif", fontSize: 24, fontWeight: 700 }}>
            Set up your workspace
          </h1>
          <p style={{ color: preview.mute, marginTop: 8, marginBottom: 0, fontSize: 14, lineHeight: 1.45 }}>
            Add your factory logo and colours so the app feels like yours — like setting up a new store.
            You can change this later anytime.
          </p>
        </div>

        <div
          style={{
            background: preview.panel,
            border: `1px solid ${preview.line}`,
            borderRadius: 16,
            padding: 22,
            marginBottom: 16,
          }}
        >
          <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 6 }}>
            Factory name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle(preview)}
            placeholder="e.g. Al Sugri Beverages"
          />

          <div style={{ marginTop: 18 }}>
            <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 8 }}>
              Logo
            </label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 12,
                  background: preview.bg,
                  border: `1px dashed ${preview.line}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {logo ? (
                  <img src={logo} alt="Logo preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <Upload size={22} color={preview.mute} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
                <button type="button" onClick={() => fileRef.current?.click()} style={btnGhost(preview)}>
                  Upload logo
                </button>
                {logo && (
                  <button
                    type="button"
                    onClick={() => setLogo(null)}
                    style={{ ...btnGhost(preview), marginTop: 8, color: preview.mute }}
                  >
                    Remove
                  </button>
                )}
                <div style={{ fontSize: 11, color: preview.mute, marginTop: 8 }}>
                  PNG or JPG, under 600KB. Square works best.
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 10 }}>
              Colour preset
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyPreset(p)}
                  style={{
                    ...btnGhost(preview),
                    width: "auto",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderColor:
                      accentColor === p.accentColor && bgColor === p.bgColor ? preview.aqua : preview.line,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 4,
                      background: p.accentColor,
                      border: `1px solid ${p.bgColor}`,
                    }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            <ColorField label="Accent" value={accentColor} onChange={setAccentColor} preview={preview} />
            <ColorField label="Background" value={bgColor} onChange={setBgColor} preview={preview} />
            <ColorField label="Panels" value={panelColor} onChange={setPanelColor} preview={preview} />
          </div>

          {/* Live preview card */}
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 12, color: preview.mute, marginBottom: 8 }}>Preview</div>
            <div
              style={{
                background: preview.bg,
                borderRadius: 12,
                border: `1px solid ${preview.line}`,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: preview.panel,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {logo ? (
                    <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <Droplet size={18} color={preview.aqua} />
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{name || "Your factory"}</div>
                  <div style={{ fontSize: 11, color: preview.mute }}>Ops · {user?.name || "Owner"}</div>
                </div>
              </div>
              <div
                style={{
                  background: preview.panel,
                  borderRadius: 10,
                  padding: 12,
                  border: `1px solid ${preview.line}`,
                }}
              >
                <div style={{ fontSize: 11, color: preview.mute, marginBottom: 6 }}>This week</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: preview.aqua }}>1,240</div>
                    <div style={{ fontSize: 11, color: preview.mute }}>Bags produced</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>GH₵8.4k</div>
                    <div style={{ fontSize: 11, color: preview.mute }}>Revenue</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div style={{ color: "#E8604C", fontSize: 13, marginTop: 14 }}>{error}</div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => save(true)}
            style={{
              ...btnPrimary(preview),
              marginTop: 20,
              opacity: busy ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Check size={18} />
            {busy ? "Saving…" : "Save and start working"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const updated = await api.updateOrgBranding(org.id, {
                  setupComplete: true,
                });
                onComplete({ ...org, name: updated.name, branding: updated.branding });
              } catch {
                onSkip?.({
                  ...org,
                  branding: { ...branding, setupComplete: true },
                });
              } finally {
                setBusy(false);
              }
            }}
            style={{
              background: "none",
              border: "none",
              color: preview.mute,
              marginTop: 4,
              width: "100%",
              cursor: "pointer",
              fontSize: 13,
              padding: 8,
            }}
          >
            Skip for now — use default look
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, preview }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 6 }}>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="color"
          value={normalizeHex(value)}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 42,
            height: 42,
            border: `1px solid ${preview.line}`,
            borderRadius: 8,
            background: preview.bg,
            padding: 2,
            cursor: "pointer",
          }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle(preview), flex: 1 }}
        />
      </div>
    </div>
  );
}

function normalizeHex(v) {
  const s = String(v || "");
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return "#2FD8C7";
}

function inputStyle(C) {
  return {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    background: C.bg,
    color: C.text,
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
  };
}

function btnPrimary(C) {
  return {
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
}

function btnGhost(C) {
  return {
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
}

/**
 * Compact branding editor used from Settings inside the main app.
 */
export function BrandingSettings({ org, onSaved, showToast }) {
  const branding = { ...DEFAULT_BRANDING, ...(org.branding || {}) };
  const [name, setName] = useState(org.name || "");
  const [logo, setLogo] = useState(branding.logo);
  const [accentColor, setAccentColor] = useState(branding.accentColor);
  const [bgColor, setBgColor] = useState(branding.bgColor);
  const [panelColor, setPanelColor] = useState(branding.panelColor);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const preview = themeFromBranding({ logo, accentColor, bgColor, panelColor });

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 600_000) {
      showToast?.("Logo too large (max ~600KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateOrgBranding(org.id, {
        name: name.trim() || org.name,
        logo,
        accentColor,
        bgColor,
        panelColor,
        setupComplete: true,
      });
      onSaved({ ...org, name: updated.name, branding: updated.branding });
      showToast?.("Branding saved");
    } catch (err) {
      showToast?.(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: preview.mute, marginBottom: 14, lineHeight: 1.45 }}>
        Your logo and colours appear in the header and across the app for everyone in this factory.
      </div>
      <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 6 }}>Factory name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle(preview), marginBottom: 14 }} />

      <label style={{ display: "block", fontSize: 12, color: preview.mute, marginBottom: 8 }}>Logo</label>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 10,
            background: preview.bg,
            border: `1px solid ${preview.line}`,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {logo ? (
            <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <Droplet size={20} color={preview.aqua} />
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...btnGhost(preview), width: "auto" }}>
          Change logo
        </button>
        {logo && (
          <button type="button" onClick={() => setLogo(null)} style={{ ...btnGhost(preview), width: "auto", color: preview.mute }}>
            Remove
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <ColorField label="Accent" value={accentColor} onChange={setAccentColor} preview={preview} />
        <ColorField label="Background" value={bgColor} onChange={setBgColor} preview={preview} />
        <ColorField label="Panels" value={panelColor} onChange={setPanelColor} preview={preview} />
      </div>

      <button type="button" disabled={busy} onClick={save} style={{ ...btnPrimary(preview), opacity: busy ? 0.7 : 1 }}>
        {busy ? "Saving…" : "Save branding"}
      </button>
    </div>
  );
}
