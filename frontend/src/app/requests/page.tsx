"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Cog,
  Users,
  Monitor,
  Shield,
  ShieldOff,
  Zap,
  ZapOff,
  Copy,
  ChevronDown,
  ChevronRight,
  Check,
  GitBranch,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const API = API_BASE;

type Tab = "home" | "accounts" | "profiles";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-accent-amber/10 text-accent-amber",
  PROCESSING: "bg-accent-cyan/10 text-accent-cyan",
  COMPLETED: "bg-accent-emerald/10 text-accent-emerald",
  FAILED: "bg-accent-red/10 text-accent-red",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  PENDING: Clock,
  PROCESSING: Cog,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
};

const TAB_LIST: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "home", label: "Home", icon: Activity },
  { key: "accounts", label: "Account Log", icon: Users },
  { key: "profiles", label: "Profile Log", icon: Monitor },
];

type TimeRange = "all" | "1m" | "5m" | "1h" | "today" | "yesterday";

const TIME_FILTERS: { key: TimeRange; label: string }[] = [
  { key: "all", label: "All" },
  { key: "1m", label: "1m ago" },
  { key: "5m", label: "5m ago" },
  { key: "1h", label: "1h ago" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
];

function getDateRange(range: TimeRange): { from: string; to: string } {
  const now = new Date();
  if (range === "all") return { from: "", to: "" };
  if (range === "1m") {
    const d = new Date(now.getTime() - 60_000);
    return { from: d.toISOString(), to: "" };
  }
  if (range === "5m") {
    const d = new Date(now.getTime() - 300_000);
    return { from: d.toISOString(), to: "" };
  }
  if (range === "1h") {
    const d = new Date(now.getTime() - 3_600_000);
    return { from: d.toISOString(), to: "" };
  }
  if (range === "today") {
    const today = now.toISOString().slice(0, 10);
    return { from: today + "T00:00:00Z", to: today + "T23:59:59Z" };
  }
  if (range === "yesterday") {
    const d = new Date(now.getTime() - 86_400_000);
    const y = d.toISOString().slice(0, 10);
    return { from: y + "T00:00:00Z", to: y + "T23:59:59Z" };
  }
  return { from: "", to: "" };
}

function isWithinTimeRange(dateStr: string, range: TimeRange): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr).getTime();
  const now = Date.now();
  if (range === "1m") return d >= now - 60_000;
  if (range === "5m") return d >= now - 300_000;
  if (range === "1h") return d >= now - 3_600_000;
  if (range === "today") {
    const today = new Date().toISOString().slice(0, 10);
    return new Date(dateStr).toISOString().slice(0, 10) === today;
  }
  if (range === "yesterday") {
    const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    return new Date(dateStr).toISOString().slice(0, 10) === y;
  }
  return true;
}

function TimeFilterBar({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  return (
    <div className="flex gap-1.5">
      {TIME_FILTERS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            value === key
              ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
              : "text-text-muted hover:text-text-secondary border border-transparent hover:bg-zinc-800/50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface AccountLog {
  id: string;
  name: string;
  in_use: number;
  max_count: number;
  models: string[];
  locked: boolean;
  stats: { completed: number; failed: number; processing: number; pending: number; total: number };
  recent_requests: any[];
  session: { pid: number; status: string; uptime_s: number; has_token: boolean } | null;
}

interface ProfileLog {
  profile_id: string | null;
  profile_id_short: string;
  account_id: string | null;
  account_name: string;
  account_names: string[];
  site: string;
  is_live: boolean;
  total_sessions: number;
  total_jobs: number;
  total_duration_s: number;
  stats?: { completed: number; failed: number; processing: number; pending: number } | null;
  sessions: {
    session_id: string | null;
    pid: number | null;
    chrome_status: string;
    is_live: boolean;
    has_token: boolean;
    account_id: string | null;
    account_name: string;
    opened_at: string | null;
    closed_at: string | null;
    duration_s: number;
    auto_close_in: number;
    current_request: { type: string; progress_pct: number; progress_stage: string; project_name?: string; project_id?: string } | null;
    jobs: any[];
    job_count: number;
  }[];
  models?: string[];
  max_count?: number;
  in_use?: number;
  project_mode?: string;
  bound_project?: { id: string; name: string } | null;
  latest_opened_at: string | null;
}

function formatUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatCountdown(s: number) {
  if (s <= 0) return "Closing...";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function ProjectBadge({ name, id }: { name?: string; id?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!id) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent-amber/10 text-accent-amber cursor-pointer select-all"
      onClick={() => setExpanded(!expanded)}
      title="Click to expand/collapse full ID"
    >
      {expanded ? (
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      ) : (
        <ChevronRight className="w-3 h-3 flex-shrink-0" />
      )}
      {name && <span>{name}</span>}
      <span className={`font-mono ${name ? "text-text-muted" : ""}`}>
        {expanded ? id : id.slice(0, 8) + "..."}
      </span>
      <span
        onClick={handleCopy}
        className="ml-0.5 hover:text-accent-pink transition-colors flex-shrink-0"
        title="Copy full ID"
      >
        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </span>
    </span>
  );
}

export default function RequestsPage() {
  const router = useRouter();
  const toast = { success: (m: string) => console.log(m), error: (m: string) => console.error(m) };
  const [activeTab, setActiveTab] = useState<Tab>("home");

  // ── Home tab state ──
  const [requests, setRequests] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState<TimeRange>("all");

  // ── Account Log state ──
  const [accountLogs, setAccountLogs] = useState<AccountLog[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountTimeFilter, setAccountTimeFilter] = useState<TimeRange>("all");

  // ── Profile Log state ──
  const [profileLogs, setProfileLogs] = useState<ProfileLog[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileSubTab, setProfileSubTab] = useState<"timeline" | "profiles">("timeline");
  const [profileTimeFilter, setProfileTimeFilter] = useState<TimeRange>("all");

  // ── Profile Timeline state ──
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/accounts`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, string> = {};
        data.forEach((a: any) => {
          map[a.id] = a.name;
        });
        setAccounts(map);
      }
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", dev: "true" });
      if (filter !== "all") params.set("status", filter);
      const { from, to } = getDateRange(timeFilter);
      if (from) params.set("from_date", from);
      if (to) params.set("to_date", to);
      const res = await fetch(`${API}/api/requests?${params}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, [filter, timeFilter]);

  const loadAccountLogs = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch(`${API}/api/requests/log/accounts`);
      const data = await res.json();
      setAccountLogs(Array.isArray(data) ? data : []);
    } catch {}
    setAccountsLoading(false);
  }, []);

  const loadProfileLogs = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const res = await fetch(`${API}/api/requests/log/profiles`);
      const data = await res.json();
      setProfileLogs(Array.isArray(data) ? data : []);
    } catch {}
    setProfilesLoading(false);
  }, []);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await fetch(`${API}/api/requests/log/profiles/timeline`);
      const data = await res.json();
      setTimelineData(Array.isArray(data) ? data : []);
    } catch {}
    setTimelineLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load, loadAccounts]);

  useEffect(() => {
    if (activeTab === "accounts") {
      loadAccountLogs();
      const interval = setInterval(loadAccountLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, loadAccountLogs]);

  useEffect(() => {
    if (activeTab === "profiles") {
      loadProfileLogs();
      loadTimeline();
      const interval = setInterval(() => {
        loadProfileLogs();
        loadTimeline();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, loadProfileLogs, loadTimeline]);

  const refreshAll = () => {
    load();
    if (activeTab === "accounts") loadAccountLogs();
    if (activeTab === "profiles") { loadProfileLogs(); loadTimeline(); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-text flex items-center gap-3">
            <Activity className="w-8 h-8" />
            Requests
          </h1>
          <p className="text-text-secondary mt-1">
            Real-time request monitor with account and profile tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/requests/flow")}
            className="px-4 py-2 rounded-xl glass hover:bg-accent-violet/10 text-text-secondary hover:text-accent-violet transition-all flex items-center gap-2 text-sm border border-accent-violet/20"
          >
            <GitBranch className="w-4 h-4" />
            Flow Debug
          </button>
          <button
            onClick={refreshAll}
            className="px-4 py-2 rounded-xl glass hover:bg-bg-card-hover/50 text-text-secondary hover:text-text-primary transition-all flex items-center gap-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-2">
        {TAB_LIST.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === key
                ? "bg-gradient-to-r from-accent-violet to-accent-pink text-white"
                : "glass text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ HOME TAB ═══════════════════ */}
      {activeTab === "home" && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-2">
              {["all", "PENDING", "PROCESSING", "COMPLETED", "FAILED"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    filter === s
                      ? "bg-gradient-to-r from-accent-violet to-accent-pink text-white"
                      : "glass text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <TimeFilterBar value={timeFilter} onChange={setTimeFilter} />
            </div>
          </div>

          {loading && requests.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
              Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No requests found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((req: any) => {
                const StatusIcon = STATUS_ICONS[req.status] || Clock;
                const accountName = req.account_name || (req.account_id
                  ? accounts[req.account_id] || req.account_id.slice(0, 8) + "..."
                  : null);
                return (
                  <div
                    key={req.id}
                    onClick={() => router.push(`/requests/${req.id}`)}
                    className="glass rounded-xl p-4 hover:bg-bg-card-hover/50 transition-all cursor-pointer hover:border-accent-violet/30"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <StatusIcon className="w-5 h-5 text-text-secondary" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {req.type || req.req_type}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs ${
                                STATUS_COLORS[req.status] || ""
                              }`}
                            >
                              {req.status}
                            </span>
                            {accountName && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-accent-violet/10 text-accent-violet flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {accountName}
                              </span>
                            )}
                            {req.chrome_pid && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-accent-cyan/10 text-accent-cyan flex items-center gap-1">
                                <Monitor className="w-3 h-3" />
                                {req.chrome_pid}
                              </span>
                            )}
                            {req.project_name && (
                              <ProjectBadge name={req.project_name} id={req.project_id} />
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5 font-mono">
                            {req.id?.slice(0, 16)}...
                          </p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-text-muted">
                        {req.progress_pct > 0 && req.progress_pct < 100 && (
                          <p className="text-accent-cyan font-mono">
                            {req.progress_pct}% {req.progress_stage}
                          </p>
                        )}
                        {req.error_message && (
                          <p className="text-accent-red max-w-[200px] truncate">
                            {req.error_message}
                          </p>
                        )}
                        {req.created_at && (
                          <p>{new Date(req.created_at).toLocaleTimeString()}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ ACCOUNT LOG TAB ═══════════════════ */}
      {activeTab === "accounts" && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-secondary">Account Log</h2>
            <TimeFilterBar value={accountTimeFilter} onChange={setAccountTimeFilter} />
          </div>
          {accountsLoading ? (
            <div className="text-center py-12 text-text-muted">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
              Loading accounts...
            </div>
          ) : accountLogs.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No accounts configured</p>
            </div>
          ) : (
            <div className="space-y-4">
              {accountLogs.map((acc) => {
                const usagePct = acc.max_count > 0 ? (acc.in_use / acc.max_count) * 100 : 0;
                return (
                  <div
                    key={acc.id}
                    onClick={() => router.push(`/requests/profiles/${acc.id}`)}
                    className={`glass rounded-xl p-5 transition-all cursor-pointer hover:bg-bg-card-hover/50 hover:border-accent-violet/30 ${
                      acc.locked ? "border border-red-500/20" : acc.session ? "border border-accent-violet/20" : ""
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          acc.locked ? "bg-red-400 animate-pulse" :
                          acc.session ? "bg-green-400" :
                          "bg-gray-400"
                        }`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">{acc.name}</span>
                            {acc.locked ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 flex items-center gap-1">
                                <ShieldOff className="w-3 h-3" /> LOCKED
                              </span>
                            ) : acc.session ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-400 flex items-center gap-1">
                                <Shield className="w-3 h-3" /> ACTIVE
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/20 text-gray-400">
                                IDLE
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted font-mono mt-0.5">{acc.id.slice(0, 12)}...</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {acc.session && (
                          <p className="text-xs text-accent-cyan">
                            PID {acc.session.pid} · {formatUptime(acc.session.uptime_s)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Stats bar */}
                    <div className="grid grid-cols-5 gap-3 mb-3">
                      {[
                        { label: "In Use", value: `${acc.in_use}/${acc.max_count}`, color: usagePct > 80 ? "text-red-400" : "text-accent-cyan" },
                        { label: "Completed", value: acc.stats.completed, color: "text-accent-emerald" },
                        { label: "Failed", value: acc.stats.failed, color: "text-accent-red" },
                        { label: "Processing", value: acc.stats.processing, color: "text-accent-amber" },
                        { label: "Pending", value: acc.stats.pending, color: "text-accent-violet" },
                      ].map((s) => (
                        <div key={s.label} className="text-center p-2 rounded-lg bg-bg-primary/50">
                          <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</p>
                          <p className="text-[10px] text-text-muted">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Usage bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                        <span>Capacity</span>
                        <span>{acc.in_use} / {acc.max_count}</span>
                      </div>
                      <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            usagePct > 80 ? "bg-red-400" : "bg-accent-violet"
                          }`}
                          style={{ width: `${Math.min(100, usagePct)}%` }}
                        />
                      </div>
                    </div>

                    {/* Models */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] text-text-muted">Models:</span>
                      {acc.models.map((m) => (
                        <span key={m} className="px-2 py-0.5 rounded-full text-[10px] bg-accent-pink/10 text-accent-pink font-mono">
                          {m}
                        </span>
                      ))}
                    </div>

                    {/* Recent requests */}
                    {(() => {
                      const filtered = accountTimeFilter === "all"
                        ? acc.recent_requests
                        : acc.recent_requests.filter((r: any) => isWithinTimeRange(r.created_at, accountTimeFilter));
                      return filtered.length > 0 ? (
                        <div>
                          <p className="text-[10px] text-text-muted mb-1.5">Recent Requests</p>
                          <div className="space-y-1">
                            {filtered.map((req: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                STATUS_COLORS[req.status] || "bg-[#2a2a4a] text-text-muted"
                              }`}>
                                {req.status.slice(0, 3)}
                              </span>
                              <span className="text-text-secondary">{req.type}</span>
                              {req.progress_pct > 0 && req.progress_pct < 100 && (
                                <span className="text-accent-cyan font-mono">{req.progress_pct}%</span>
                              )}
                              {req.chrome_pid && (
                                <span className="text-text-muted font-mono">pid:{req.chrome_pid}</span>
                              )}
                              {req.project_name && (
                                <ProjectBadge name={req.project_name} id={req.project_id} />
                              )}
                               <span className="text-text-muted ml-auto">{new Date(req.created_at).toLocaleTimeString()}</span>
                            </div>
                          ))}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ PROFILE LOG TAB ═══════════════════ */}
      {activeTab === "profiles" && (
        <>
          {/* ── Sub-tab bar ── */}
          <div className="flex items-center gap-2 mb-4">
            {(["timeline", "profiles"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setProfileSubTab(key)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  profileSubTab === key
                    ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                    : "text-text-muted hover:text-text-secondary border border-transparent"
                }`}
              >
                {key === "timeline" ? "Timeline" : "Profiles"}
              </button>
            ))}
            <div className="ml-auto">
              <TimeFilterBar value={profileTimeFilter} onChange={setProfileTimeFilter} />
            </div>
          </div>

          {/* ═══════════════ TIMELINE SUB-TAB ═══════════════ */}
          {profileSubTab === "timeline" && (
            <>
              {timelineLoading ? (
                <div className="text-center py-12 text-text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
                  Loading timeline...
                </div>
              ) : (() => {
                const filtered = profileTimeFilter === "all"
                  ? timelineData
                  : timelineData.filter((j: any) => isWithinTimeRange(j.created_at, profileTimeFilter));
                return filtered.length === 0 ? (
                  <div className="text-center py-12 text-text-muted">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No jobs yet</p>
                    <p className="text-xs mt-1">Jobs appear here as they are processed</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                  {/* ── Header row ── */}
                  <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wide">
                    <span className="w-[140px]">Time</span>
                    <span className="w-[130px]">Type</span>
                    <span className="w-[80px]">Status</span>
                    <span className="w-[100px]">Profile</span>
                    <span className="flex-1">Account</span>
                    <span className="w-[120px] text-right">Project</span>
                  </div>
                  {filtered.map((job) => {
                    const StatusIcon = STATUS_ICONS[job.status] || Clock;
                    const statusColor = STATUS_COLORS[job.status] || "";
                    return (
                      <div
                        key={job.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-card-hover/30 transition-colors text-xs"
                      >
                        {/* Time */}
                        <span className="w-[140px] font-mono text-text-muted text-[11px]">
                          {new Date(job.created_at).toLocaleString("en-US", {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                          })}
                        </span>

                        {/* Type */}
                        <span className="w-[130px] text-text-secondary font-medium truncate">
                          {job.type?.replace(/_/g, " ")}
                        </span>

                        {/* Status */}
                        <span className="w-[80px] flex items-center gap-1.5">
                          <StatusIcon className="w-3 h-3 text-text-muted" />
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusColor}`}>
                            {job.status}
                          </span>
                        </span>

                        {/* Profile */}
                        <span className="w-[100px] font-mono text-[10px] text-text-muted truncate" title={job.profile_id || ""}>
                          {job.profile_id_short || "—"}
                        </span>

                        {/* Account */}
                        <span className="flex-1 text-text-secondary truncate">
                          {job.account_name || "—"}
                        </span>

                        {/* Project */}
                        <span className="w-[120px] text-right truncate">
                          {job.project_name ? (
                            <ProjectBadge name={job.project_name} id={job.project_id} />
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </>
          )}

          {/* ═══════════════ PROFILES SUB-TAB ═══════════════ */}
          {profileSubTab === "profiles" && (
            <>
              {profilesLoading ? (
                <div className="text-center py-12 text-text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
                  Loading profiles...
                </div>
              ) : profileLogs.length === 0 ? (
                <div className="text-center py-12 text-text-muted">
                  <Monitor className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No Chrome profile history yet</p>
                  <p className="text-xs mt-1">Chrome launches on first generation request</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {profileLogs.map((p) => (
                    <div
                      key={p.profile_id || `orphan-${p.profile_id_short}`}
                      className={`glass rounded-xl overflow-hidden transition-all ${
                        !p.profile_id
                          ? "border border-red-500/20 bg-red-500/5"
                          : p.is_live
                            ? "border border-accent-emerald/20 bg-accent-emerald/5"
                            : "border border-border/30"
                      }`}
                    >
                      {/* ── Profile Header ── */}
                      <div className="px-5 pt-4 pb-3 border-b border-border/20">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${
                              !p.profile_id ? "bg-red-400 animate-pulse" :
                              p.is_live ? "bg-green-400 animate-pulse" :
                              "bg-zinc-500"
                            }`} />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-bold text-text-primary">
                                  {p.profile_id_short}
                                </span>
                                {p.is_live && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-emerald/20 text-accent-emerald">RUNNING</span>
                                )}
                                {!p.is_live && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/20 text-zinc-400">CLOSED</span>
                                )}
                                <span className="text-[10px] text-text-muted">
                                  {p.total_sessions} session{p.total_sessions !== 1 ? "s" : ""}
                                </span>
                              </div>
                              <p className="text-[11px] text-text-muted font-mono mt-0.5">
                                {p.site} · {p.account_name}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] mt-2 flex-wrap">
                          {p.stats && (
                            <>
                              {p.stats.completed > 0 && <span className="text-accent-emerald font-bold">{p.stats.completed} done</span>}
                              {p.stats.failed > 0 && <span className="text-accent-red font-bold">{p.stats.failed} failed</span>}
                              {p.stats.processing > 0 && <span className="text-accent-cyan">{p.stats.processing} active</span>}
                              {p.stats.pending > 0 && <span className="text-accent-amber">{p.stats.pending} pending</span>}
                            </>
                          )}
                          <span className="text-text-muted ml-auto">{p.total_jobs} total job{p.total_jobs !== 1 ? "s" : ""} across {p.total_sessions} session{p.total_sessions !== 1 ? "s" : ""}</span>
                        </div>
                      </div>

                      {/* ── Sessions list ── */}
                      {p.sessions.map((sess, si) => {
                        const liveSess = p.is_live && sess.is_live ? sess : null;
                        return (
                        <div key={sess.session_id || `s-${si}`} className={`px-5 py-3 ${si < p.sessions.length - 1 ? "border-b border-border/10" : ""}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${
                                sess.is_live ? "bg-green-400 animate-pulse" :
                                sess.chrome_status === "ORPHANED" ? "bg-red-400 animate-pulse" :
                                "bg-zinc-600"
                              }`} />
                              <span className="text-xs text-text-muted">Session {si + 1}</span>
                              {sess.pid && <span className="text-[10px] text-text-muted font-mono">PID {sess.pid}</span>}
                              {sess.has_token && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent-cyan/20 text-accent-cyan flex items-center gap-0.5">
                                  <Zap className="w-2.5 h-2.5" /> Token
                                </span>
                              )}
                              {sess.account_name !== p.account_name && (
                                <span className="text-[10px] text-text-muted">· {sess.account_name}</span>
                              )}
                            </div>
                            {liveSess && liveSess.auto_close_in > 0 && (
                              <span className={`text-[10px] font-mono font-bold ${liveSess.auto_close_in <= 60 ? "text-red-400" : "text-accent-amber"}`}>
                                {formatCountdown(liveSess.auto_close_in)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-text-muted mb-2 pl-4">
                            {sess.opened_at && (
                              <span className="flex items-center gap-1">
                                <span className="text-accent-emerald">▶</span>
                                <span className="font-mono">{new Date(sess.opened_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
                              </span>
                            )}
                            {sess.duration_s > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-bg-primary/50 font-mono">{formatUptime(sess.duration_s)}</span>
                            )}
                            {sess.closed_at && (
                              <span className="flex items-center gap-1">
                                <span className="text-accent-red">■</span>
                                <span className="font-mono">{new Date(sess.closed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
                              </span>
                            )}
                            {!sess.closed_at && sess.is_live && (
                              <span className="flex items-center gap-1">
                                <span className="text-accent-emerald animate-pulse">●</span>
                                <span className="font-mono text-accent-emerald">running</span>
                              </span>
                            )}
                            {sess.job_count > 0 && (
                              <span className="text-text-muted">{sess.job_count} job{sess.job_count !== 1 ? "s" : ""}</span>
                            )}
                          </div>
                          {sess.current_request && (
                            <div className="pl-4 mb-2">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Cog className="w-3 h-3 text-accent-violet animate-spin" />
                                  <span className="text-[10px] font-medium text-accent-violet">
                                    {sess.current_request.type.replace(/_/g, " ")}
                                  </span>
                                  {sess.current_request.project_name && (
                                    <ProjectBadge name={sess.current_request.project_name} id={sess.current_request.project_id} />
                                  )}
                                </div>
                                <span className="text-[10px] font-mono text-accent-cyan">
                                  {sess.current_request.progress_pct}%
                                </span>
                              </div>
                              <div className="h-1 bg-bg-primary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-accent-violet rounded-full transition-all"
                                  style={{ width: `${sess.current_request.progress_pct}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {sess.jobs && sess.jobs.length > 0 && (() => {
                            const filteredJobs = profileTimeFilter === "all"
                              ? sess.jobs
                              : sess.jobs.filter((r: any) => isWithinTimeRange(r.created_at, profileTimeFilter));
                            return filteredJobs.length > 0 ? (
                            <div className="pl-4">
                              <div className="relative pl-4">
                                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border/30" />
                                <div className="space-y-1.5">
                                  {filteredJobs.map((req: any) => {
                                    const dotColor =
                                      req.status === "COMPLETED" ? "bg-accent-emerald" :
                                      req.status === "FAILED" ? "bg-accent-red" :
                                      req.status === "PROCESSING" ? "bg-accent-cyan animate-pulse" :
                                      "bg-zinc-500";
                                    return (
                                      <div key={req.id} className="relative flex items-start gap-3 text-[10px]">
                                        <div className={`absolute -left-4 top-1 w-2 h-2 rounded-full border-2 border-bg-primary ${dotColor}`} />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-mono text-text-muted">
                                              {new Date(req.created_at).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                            </span>
                                            <span className="text-text-secondary font-medium">{req.type?.replace(/_/g, " ")}</span>
                                            <span className={`px-1.5 py-0.5 rounded-full ${STATUS_COLORS[req.status] || ""}`}>{req.status}</span>
                                            {req.project_name && (
                                              <span className="text-text-muted">→ {req.project_name}</span>
                                            )}
                                          </div>
                                          {req.error_message && (
                                            <p className="text-accent-red mt-0.5 truncate">{req.error_message}</p>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                            ) : null;
                          })()}
                        </div>
                        );
                      })}

                      {p.is_live && p.sessions.some(s => s.is_live && s.auto_close_in > 0) && (
                        <div className="px-5 pb-3 pt-1">
                          <div className="h-1 bg-bg-primary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-amber/50 rounded-full transition-all"
                              style={{ width: `${Math.max(0, ((p.sessions.find(s => s.is_live)?.auto_close_in || 0) / 600) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
