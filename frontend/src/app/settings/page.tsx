"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Settings,
  Loader2,
  Save,
  CheckCircle,
  Monitor,
  Cpu,
  Wifi,
  WifiOff,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Shield,
  Server,
  Zap,
  Clock,
  Database,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { API_BASE } from "@/lib/api";

const API = API_BASE;

const MODEL_TYPES = [
  {
    key: "generate_image",
    label: "Image Generation",
    options: ["NANO_BANANA_2", "NANO_BANANA_PRO"],
  },
  {
    key: "generate_video",
    label: "Video Generation",
    options: [
      "veo_3_1_i2v_lite_low_priority",
      "veo_3_1_i2v_fast_low_priority",
      "veo_3_1_i2v_standard_low_priority",
    ],
  },
  {
    key: "generate_video_refs",
    label: "Video References",
    options: [
      "veo_3_1_r2v_fast_landscape_ultra_relaxed",
      "veo_3_1_r2v_standard_portrait_relaxed",
    ],
  },
  {
    key: "upscale_video",
    label: "Video Upscale",
    options: ["veo_3_1_upsampler_4k", "veo_3_1_upsampler_1080p"],
  },
  {
    key: "edit_image",
    label: "Image Edit",
    options: ["NANO_BANANA_2", "NANO_BANANA_PRO"],
  },
];

function formatUptime(createdAt: number, nowMs: number) {
  const s = Math.max(0, Math.floor((nowMs / 1000) - createdAt));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

interface SettingField {
  key: string;
  label: string;
  type: string;
  group: string;
  value: string;
  min?: number;
  max?: number;
}

interface ChromeProfile {
  session_id: string;
  account_id: string;
  account_name: string;
  site: string;
  pid: number;
  status: string;
  has_token: boolean;
  uptime_s: number;
  created_at: number;
  is_busy: boolean;
  in_use: number;
  max_count: number;
  busy_request: { id: string; type: string; progress_pct: number; progress_stage: string } | null;
  profile_dir: string;
  is_orphaned: boolean;
  auto_close_in: number;
}

export default function SettingsPage() {
  const toast = useToast();

  // ── Defaults ──
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [savingDefault, setSavingDefault] = useState<string | null>(null);
  const [savedDefault, setSavedDefault] = useState<string | null>(null);

  // ── Server Settings ──
  const [settings, setSettings] = useState<Record<string, SettingField>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsDirty, setSettingsDirty] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // ── Chrome Profiles ──
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const profilesTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [now, setNow] = useState(Date.now());

  // ── Extension ──
  const [ext, setExt] = useState<any>(null);
  const [extLoading, setExtLoading] = useState(true);

  // ── Actions ──
  const [actionRunning, setActionRunning] = useState<string | null>(null);

  // ─── Load defaults ──
  useEffect(() => {
    fetch(`${API}/api/defaults`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const map: Record<string, string> = {};
          data.forEach((d: any) => {
            map[d.type] = d.model;
          });
          setDefaults(map);
        }
      })
      .catch(() => {});
    setDefaultsLoading(false);
  }, []);

  // ─── Load server settings ──
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings`);
      const data = await res.json();
      setSettings(data);
    } catch {}
    setSettingsLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ─── Load profiles (auto-refresh) ──
  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/profiles`);
      const data = await res.json();
      setProfiles(data.active_sessions || []);
    } catch {}
    setProfilesLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
    profilesTimer.current = setInterval(loadProfiles, 5000);
    return () => {
      if (profilesTimer.current) clearInterval(profilesTimer.current);
    };
  }, [loadProfiles]);

  // ─── Live timer tick (every second) ──
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── Load extension status ──
  const loadExtension = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings/extension`);
      const data = await res.json();
      setExt(data);
    } catch {}
    setExtLoading(false);
  }, []);

  useEffect(() => {
    loadExtension();
    const t = setInterval(loadExtension, 5000);
    return () => clearInterval(t);
  }, [loadExtension]);

  // ─── Save default model ──
  const handleSaveDefault = async (type: string, model: string) => {
    setSavingDefault(type);
    try {
      await fetch(`${API}/api/defaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, model }),
      });
      setDefaults((prev) => ({ ...prev, [type]: model }));
      setSavedDefault(type);
      setTimeout(() => setSavedDefault(null), 2000);
      toast.success(`${type} updated to ${model}`);
    } catch {
      toast.error("Failed to save default model");
    }
    setSavingDefault(null);
  };

  // ─── Save server settings ──
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const updates = Object.entries(settingsDirty).map(([key, value]) => ({
        key,
        value,
      }));
      if (updates.length === 0) {
        setSavingSettings(false);
        return;
      }
      const res = await fetch(`${API}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("Settings saved. Restart server to apply.");
        setSettingsDirty({});
        loadSettings();
      } else {
        toast.error(data.detail || "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    }
    setSavingSettings(false);
  };

  // ─── Kill profile ──
  const handleKillProfile = async (sid: string, pid: number, isOrphaned: boolean) => {
    try {
      if (isOrphaned) {
        await fetch(`${API}/api/settings/profiles/orphan/${pid}/kill`, { method: "POST" });
        toast.success(`Orphaned Chrome PID ${pid} killed`);
      } else {
        await fetch(`${API}/api/settings/profiles/${sid}/kill`, { method: "POST" });
        toast.success(`Session ${sid.slice(0, 8)} killed`);
      }
      loadProfiles();
    } catch {
      toast.error("Failed to kill session");
    }
  };

  // ─── Kill all profiles ──
  const handleKillAll = async () => {
    setActionRunning("kill-all");
    try {
      const res = await fetch(`${API}/api/settings/profiles/kill-all`, {
        method: "POST",
      });
      const data = await res.json();
      toast.success(`Killed ${data.count} Chrome instances`);
      loadProfiles();
    } catch {
      toast.error("Failed to kill all");
    }
    setActionRunning(null);
  };

  // ─── Quick actions ──
  const handleAction = async (action: string, label: string) => {
    setActionRunning(action);
    try {
      const res = await fetch(`${API}/api/settings/actions/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      toast.success(`${label} completed: ${data.recovered ?? data.reset ?? 0} items`);
    } catch {
      toast.error(`${label} failed`);
    }
    setActionRunning(null);
  };

  // ─── Reconnect extension ──
  const handleReconnect = async () => {
    setActionRunning("reconnect");
    try {
      await fetch(`${API}/api/settings/extension/reconnect`, { method: "POST" });
      toast.success("Chrome re-launch initiated");
    } catch {
      toast.error("Reconnect failed");
    }
    setActionRunning(null);
  };

  const groupedSettings: Record<string, [string, SettingField][]> = {};
  Object.entries(settings).forEach(([key, field]) => {
    const g = field.group || "other";
    if (!groupedSettings[g]) groupedSettings[g] = [];
    groupedSettings[g].push([key, field]);
  });

  const groupLabels: Record<string, string> = {
    chrome: "Chrome Browser",
    worker: "Worker",
    network: "Network",
    storage: "Storage",
  };

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold gradient-text flex items-center gap-3">
          <Settings className="w-8 h-8" />
          Settings
        </h1>
        <p className="text-text-secondary mt-1">
          Server configuration, browser profiles, and default models
        </p>
      </div>

      {/* ── 1. Active Chrome Profiles ── */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Monitor className="w-5 h-5 text-accent-violet" />
            Active Chrome Profiles
            <span className="text-xs text-text-muted ml-2">
              {profiles.length} total
            </span>
            {profiles.some((p) => p.is_orphaned) && (
              <span className="text-xs text-red-400 ml-1">
                ({profiles.filter((p) => p.is_orphaned).length} orphaned)
              </span>
            )}
          </h2>
          <button
            onClick={handleKillAll}
            disabled={actionRunning === "kill-all" || profiles.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium transition-all disabled:opacity-50"
          >
            {actionRunning === "kill-all" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Kill All
          </button>
        </div>

        {profilesLoading ? (
          <div className="text-center py-6 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Monitor className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No active Chrome instances</p>
            <p className="text-xs mt-1">Chrome launches on first generation request</p>
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <div
                key={p.session_id}
                className={`p-4 rounded-xl border transition-all ${
                  p.is_orphaned
                    ? "bg-red-500/5 border-red-500/20"
                    : p.is_busy
                      ? "bg-accent-violet/5 border-accent-violet/20"
                      : "bg-bg-primary/50 border-border/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {/* Status indicator */}
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      p.is_orphaned ? "bg-red-400 animate-pulse" :
                      p.is_busy ? "bg-accent-violet animate-pulse" :
                      p.status === "RUNNING" ? "bg-green-400" :
                      p.status === "STARTING" ? "bg-yellow-400 animate-pulse" :
                      "bg-gray-400"
                    }`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.account_name}</span>
                        <span className="text-xs text-text-muted font-mono">({p.account_id}...)</span>
                        {p.is_orphaned && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400">
                            ORPHANED
                          </span>
                        )}
                        {!p.is_orphaned && p.is_busy && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-violet/20 text-accent-violet">
                            BUSY
                          </span>
                        )}
                        {!p.is_orphaned && !p.is_busy && p.status === "RUNNING" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400">
                            IDLE
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                        <span>PID {p.pid || "?"}</span>
                        <span>·</span>
                        <span>{p.site}</span>
                        <span>·</span>
                        <span className="font-mono">{formatUptime(p.created_at, now)}</span>
                        <span>·</span>
                        {!p.is_orphaned && (
                          <>
                            <span className={p.has_token ? "text-green-400" : "text-yellow-400"}>
                              {p.has_token ? "Token ✓" : "Token pending"}
                            </span>
                            <span>·</span>
                          </>
                        )}
                        {/* Auto-close countdown */}
                        {p.auto_close_in > 0 && (
                          <span className="text-accent-amber font-mono">
                            Auto-close in {Math.floor(p.auto_close_in / 60)}m {p.auto_close_in % 60}s
                          </span>
                        )}
                        {p.auto_close_in <= 0 && !p.is_orphaned && (
                          <span className="text-red-400 font-mono">
                            Closing soon...
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleKillProfile(p.session_id, p.pid, p.is_orphaned)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-all"
                    title={p.is_orphaned ? "Kill orphan" : "Kill"}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Busy request details */}
                {p.busy_request && (
                  <div className="ml-5 mt-2 p-2.5 rounded-lg bg-bg-secondary/50 border border-border/20">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-text-secondary">
                        {p.busy_request.type}
                      </span>
                      <span className="text-xs text-text-muted font-mono">
                        {p.busy_request.progress_pct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-pink transition-all duration-500"
                        style={{ width: `${p.busy_request.progress_pct}%` }}
                      />
                    </div>
                    {p.busy_request.progress_stage && (
                      <p className="text-[10px] text-text-muted mt-1">
                        {p.busy_request.progress_stage}
                      </p>
                    )}
                  </div>
                )}

                {/* In-use counter */}
                <div className="ml-5 mt-1.5 flex items-center gap-2 text-[10px] text-text-muted">
                  <span>Slots: {p.in_use}/{p.max_count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. Server Configuration ── */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="w-5 h-5 text-accent-cyan" />
            Server Configuration
          </h2>
          {Object.keys(settingsDirty).length > 0 && (
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white text-sm font-semibold hover:opacity-90 transition-all"
            >
              {savingSettings ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save ({Object.keys(settingsDirty).length})
            </button>
          )}
        </div>

        {settingsLoading ? (
          <div className="text-center py-6 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-6">
            {["chrome", "worker", "network", "storage"].map((group) => {
              const fields = groupedSettings[group];
              if (!fields || fields.length === 0) return null;
              return (
                <div key={group}>
                  <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                    {group === "chrome" && <Monitor className="w-3.5 h-3.5" />}
                    {group === "worker" && <Cpu className="w-3.5 h-3.5" />}
                    {group === "network" && <Wifi className="w-3.5 h-3.5" />}
                    {group === "storage" && <Database className="w-3.5 h-3.5" />}
                    {groupLabels[group] || group}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {fields.map(([key, field]) => {
                      const currentVal =
                        settingsDirty[key] !== undefined
                          ? settingsDirty[key]
                          : field.value;
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-3 p-3 rounded-xl bg-bg-primary/50 border border-border/30"
                        >
                          <div className="flex-1 min-w-0">
                            <label className="text-xs text-text-muted block mb-1 truncate">
                              {field.label}
                            </label>
                            {field.type === "string" ? (
                              <input
                                type="text"
                                value={currentVal}
                                onChange={(e) =>
                                  setSettingsDirty((prev) => ({
                                    ...prev,
                                    [key]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-1.5 rounded-lg bg-bg-secondary border border-border text-sm text-text-primary focus:outline-none focus:border-accent-violet/50 transition-all font-mono"
                              />
                            ) : (
                              <input
                                type="number"
                                value={currentVal}
                                min={field.min}
                                max={field.max}
                                onChange={(e) =>
                                  setSettingsDirty((prev) => ({
                                    ...prev,
                                    [key]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-1.5 rounded-lg bg-bg-secondary border border-border text-sm text-text-primary focus:outline-none focus:border-accent-violet/50 transition-all font-mono"
                              />
                            )}
                          </div>
                          {field.min !== undefined && field.max !== undefined && (
                            <span className="text-[10px] text-text-muted whitespace-nowrap">
                              {field.min}–{field.max}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 3. Extension Status ── */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent-amber" />
            Extension Status
          </h2>
          <button
            onClick={handleReconnect}
            disabled={actionRunning === "reconnect"}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent-violet/30 transition-all disabled:opacity-50"
          >
            {actionRunning === "reconnect" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reconnect
          </button>
        </div>

        {extLoading ? (
          <div className="text-center py-6 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/30 text-center">
              {ext?.connected ? (
                <Wifi className="w-6 h-6 text-green-400 mx-auto mb-2" />
              ) : (
                <WifiOff className="w-6 h-6 text-red-400 mx-auto mb-2" />
              )}
              <p className="text-xs text-text-muted">Connection</p>
              <p
                className={`font-semibold text-sm ${
                  ext?.connected ? "text-green-400" : "text-red-400"
                }`}
              >
                {ext?.connected ? "Connected" : "Disconnected"}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/30 text-center">
              <Shield
                className={`w-6 h-6 mx-auto mb-2 ${
                  ext?.flow_key_present ? "text-green-400" : "text-yellow-400"
                }`}
              />
              <p className="text-xs text-text-muted">Flow Key</p>
              <p
                className={`font-semibold text-sm ${
                  ext?.flow_key_present ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {ext?.flow_key_present ? "Present" : "Missing"}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/30 text-center">
              <Clock className="w-6 h-6 text-accent-cyan mx-auto mb-2" />
              <p className="text-xs text-text-muted">Tier</p>
              <p className="font-semibold text-sm text-text-primary">
                {ext?.tier || "Unknown"}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/30 text-center">
              <Zap className="w-6 h-6 text-accent-violet mx-auto mb-2" />
              <p className="text-xs text-text-muted">Token</p>
              <p className="font-semibold text-sm text-text-primary font-mono truncate">
                {ext?.flow_key ? ext.flow_key : "None"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── 4. Default Models ── */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Cpu className="w-5 h-5 text-accent-pink" />
          Default Models
        </h2>

        {defaultsLoading ? (
          <div className="text-center py-6 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-3">
            {MODEL_TYPES.map((mt) => (
              <div
                key={mt.key}
                className="flex items-center gap-4 p-3 rounded-xl bg-bg-primary/50 border border-border/30"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{mt.label}</p>
                  <p className="text-xs text-text-muted font-mono">{mt.key}</p>
                </div>
                <select
                  value={defaults[mt.key] || mt.options[0]}
                  onChange={(e) => handleSaveDefault(mt.key, e.target.value)}
                  className="px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-text-primary focus:outline-none focus:border-accent-violet/50 transition-all"
                >
                  {mt.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {savingDefault === mt.key ? (
                  <Loader2 className="w-4 h-4 animate-spin text-accent-violet" />
                ) : savedDefault === mt.key ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 5. Quick Actions ── */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => handleAction("recover-accounts", "Recover Accounts")}
            disabled={actionRunning === "recover-accounts"}
            className="flex items-center gap-3 p-4 rounded-xl bg-bg-primary/50 border border-border/30 hover:border-accent-violet/30 transition-all disabled:opacity-50 text-left"
          >
            {actionRunning === "recover-accounts" ? (
              <Loader2 className="w-5 h-5 animate-spin text-accent-violet" />
            ) : (
              <Shield className="w-5 h-5 text-accent-cyan" />
            )}
            <div>
              <p className="text-sm font-medium">Recover Accounts</p>
              <p className="text-xs text-text-muted">
                Reset stuck in_use counters
              </p>
            </div>
          </button>

          <button
            onClick={() => handleAction("reset-stale", "Reset Stale Requests")}
            disabled={actionRunning === "reset-stale"}
            className="flex items-center gap-3 p-4 rounded-xl bg-bg-primary/50 border border-border/30 hover:border-accent-violet/30 transition-all disabled:opacity-50 text-left"
          >
            {actionRunning === "reset-stale" ? (
              <Loader2 className="w-5 h-5 animate-spin text-accent-violet" />
            ) : (
              <RefreshCw className="w-5 h-5 text-accent-amber" />
            )}
            <div>
              <p className="text-sm font-medium">Reset Stale Requests</p>
              <p className="text-xs text-text-muted">
                Reset stuck PROCESSING requests
              </p>
            </div>
          </button>

          <button
            onClick={handleKillAll}
            disabled={actionRunning === "kill-all" || profiles.length === 0}
            className="flex items-center gap-3 p-4 rounded-xl bg-bg-primary/50 border border-border/30 hover:border-red-500/30 transition-all disabled:opacity-50 text-left"
          >
            {actionRunning === "kill-all" ? (
              <Loader2 className="w-5 h-5 animate-spin text-red-400" />
            ) : (
              <Trash2 className="w-5 h-5 text-red-400" />
            )}
            <div>
              <p className="text-sm font-medium">Kill All Chrome</p>
              <p className="text-xs text-text-muted">
                Terminate all browser instances
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
