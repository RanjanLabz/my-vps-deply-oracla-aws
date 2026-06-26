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
  Zap,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Database,
  ListOrdered,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const API = API_BASE;

async function flushRedisQueues() {
  try {
    const res = await fetch(`${API}/api/requests/flow-debug/flush-queue`, { method: "POST" });
    return await res.json();
  } catch { return { ok: false }; }
}

const STEP_ORDER = [
  "queued",
  "assigned",
  "chrome_launching",
  "authenticating",
  "generating",
  "processing",
  "done",
  "failed",
  "auth_failed",
  "recaptcha",
  "retrying",
];

const STEP_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  queued: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30", dot: "bg-violet-500" },
  assigned: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30", dot: "bg-violet-400" },
  chrome_launching: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", dot: "bg-cyan-500 animate-pulse" },
  authenticating: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", dot: "bg-cyan-400 animate-pulse" },
  generating: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", dot: "bg-cyan-500 animate-pulse" },
  processing: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", dot: "bg-cyan-500 animate-pulse" },
  done: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  failed: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-500" },
  auth_failed: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-500" },
  recaptcha: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", dot: "bg-amber-500" },
  retrying: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", dot: "bg-amber-500 animate-pulse" },
};

const PIPELINE_STEPS = [
  { key: "queued", label: "Queued", icon: Clock },
  { key: "assigned", label: "Account", icon: Users },
  { key: "chrome_launching", label: "Chrome", icon: Monitor },
  { key: "authenticating", label: "Auth", icon: Zap },
  { key: "generating", label: "Generate", icon: Cog },
  { key: "done", label: "Done", icon: CheckCircle },
];

interface QueueItem {
  request_id: string;
  full_id: string;
  score: number;
  age_s: number;
}

interface QueueModel {
  size: number;
  items: QueueItem[];
}

interface FlowDebugData {
  requests: any[];
  accounts: any[];
  chrome_sessions: any[];
  queue_length: number;
  queue_detail: Record<string, QueueModel>;
  extension_connected: boolean;
  flow_key_present: boolean;
}

function PipelineBar({ step }: { step: string }) {
  const activeIdx = PIPELINE_STEPS.findIndex((s) => s.key === step);
  const isFailed = step === "failed" || step === "auth_failed" || step === "recaptcha";
  const isDone = step === "done";
  const isRetrying = step === "retrying";

  return (
    <div className="flex items-center gap-0.5 w-full">
      {PIPELINE_STEPS.map((s, i) => {
        const isComplete = isDone || (activeIdx >= 0 && i < activeIdx);
        const isActive = i === activeIdx;
        const isCurrentFail = isFailed && i === activeIdx;

        let color = "bg-zinc-800";
        if (isComplete) color = "bg-emerald-500/60";
        if (isActive && !isCurrentFail) color = "bg-cyan-500";
        if (isCurrentFail) color = "bg-red-500";
        if (isActive && isRetrying) color = "bg-amber-500 animate-pulse";

        return (
          <div key={s.key} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className={`h-1.5 w-full rounded-full ${color} transition-all duration-500`}
              title={s.label}
            />
          </div>
        );
      })}
    </div>
  );
}

function RequestCard({ req }: { req: any }) {
  const [expanded, setExpanded] = useState(false);
  const colors = STEP_COLORS[req.flow_step?.step || "queued"] || STEP_COLORS.queued;
  const time = req.created_at
    ? new Date(req.created_at).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";
  const elapsed = req.created_at && req.updated_at
    ? ((new Date(req.updated_at).getTime() - new Date(req.created_at).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <div
      className={`rounded-xl border ${colors.border} ${colors.bg} transition-all overflow-hidden`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
      >
        <div className={`w-2.5 h-2.5 rounded-full ${colors.dot} flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-text-muted">{req.id?.slice(0, 8)}</span>
            <span className={`text-xs font-semibold ${colors.text}`}>{req.flow_step?.label}</span>
            <span className="text-xs text-text-muted">{req.type?.replace(/_/g, " ")}</span>
          </div>
          <p className="text-[11px] text-text-muted mt-0.5 truncate">{req.flow_step?.detail}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[11px] text-text-muted font-mono">{time}</p>
          {elapsed && <p className="text-[10px] text-text-muted">{elapsed}s</p>}
        </div>
        <div className="text-text-muted flex-shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {/* Pipeline bar */}
      <div className="px-4 pb-2">
        <PipelineBar step={req.flow_step?.step || "queued"} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 text-[11px] border-t border-white/5 pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <span className="text-text-muted">Account</span>
              <p className="text-text-secondary font-mono">{req.account_name || "—"}</p>
            </div>
            <div>
              <span className="text-text-muted">Project</span>
              <p className="text-text-secondary font-mono">{req.project_name || "—"}</p>
            </div>
            <div>
              <span className="text-text-muted">Chrome PID</span>
              <p className="text-text-secondary font-mono">{req.chrome_pid || "—"} {req.chrome_alive ? "✓" : req.chrome_pid ? "✗" : ""}</p>
            </div>
            <div>
              <span className="text-text-muted">Retries</span>
              <p className="text-text-secondary font-mono">{req.retry_count}</p>
            </div>
          </div>
          {req.error_message && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-red-400">{req.error_message}</p>
            </div>
          )}
          {req.media_id && (
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-emerald-400 font-mono">media_id: {req.media_id}</p>
            </div>
          )}
          <div className="flex items-center gap-4 text-text-muted">
            <span>Created: {new Date(req.created_at).toLocaleString()}</span>
            <span>Updated: {new Date(req.updated_at).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FlowDebugPage() {
  const router = useRouter();
  const [data, setData] = useState<FlowDebugData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("active");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/requests/flow-debug`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [load]);

  const filteredRequests = data?.requests.filter((r) => {
    if (filter === "active") return !["COMPLETED", "FAILED"].includes(r.status);
    if (filter === "completed") return r.status === "COMPLETED";
    if (filter === "failed") return r.status === "FAILED";
    if (filter === "all") return true;
    return true;
  }) || [];

  const stats = data
    ? {
        total: data.requests.length,
        active: data.requests.filter((r) => !["COMPLETED", "FAILED"].includes(r.status)).length,
        completed: data.requests.filter((r) => r.status === "COMPLETED").length,
        failed: data.requests.filter((r) => r.status === "FAILED").length,
        queue: data.queue_length,
        sessions: data.chrome_sessions.length,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/requests")}
            className="flex items-center gap-1 text-text-muted hover:text-text-primary transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold gradient-text flex items-center gap-2">
              <Activity className="w-6 h-6" />
              Flow Debug
            </h1>
            <p className="text-text-secondary text-xs mt-0.5">Real-time pipeline visualization</p>
          </div>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-lg glass hover:bg-bg-card-hover/50 text-text-secondary hover:text-text-primary transition-all flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Status bar */}
      {data && (
        <div className="flex items-center gap-4 flex-wrap">
          {/* Extension status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
            data.extension_connected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}>
            {data.extension_connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            Extension {data.extension_connected ? "Connected" : "Disconnected"}
          </div>
          {data.flow_key_present && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Zap size={12} />
              Flow Key Active
            </div>
          )}

          {/* Stats */}
          {stats && (
            <>
              <div className="h-4 w-px bg-zinc-700" />
              <span className="text-xs text-text-muted">
                <span className="text-accent-cyan font-mono font-bold">{stats.active}</span> active
              </span>
              <span className="text-xs text-text-muted">
                <span className="text-accent-emerald font-mono font-bold">{stats.completed}</span> done
              </span>
              <span className="text-xs text-text-muted">
                <span className="text-accent-red font-mono font-bold">{stats.failed}</span> failed
              </span>
              {stats.queue > 0 && (
                <span className="text-xs text-text-muted">
                  <span className="text-accent-violet font-mono font-bold">{stats.queue}</span> queued
                </span>
              )}
              <span className="text-xs text-text-muted">
                <span className="text-accent-cyan font-mono font-bold">{stats.sessions}</span> Chrome{stats.sessions !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* Chrome Sessions */}
      {data && data.chrome_sessions.length > 0 && (
        <div className="glass rounded-xl p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">Active Chrome Sessions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.chrome_sessions.map((s) => (
              <div key={s.session_id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary/50 border border-border/20 text-xs">
                <div className={`w-2 h-2 rounded-full ${s.status === "RUNNING" ? "bg-green-400 animate-pulse" : "bg-zinc-500"}`} />
                <span className="text-text-secondary font-medium">{s.account_name}</span>
                <span className="text-text-muted font-mono">PID {s.pid}</span>
                {s.has_token && <Zap size={10} className="text-accent-cyan" />}
                {!s.has_token && <span className="text-accent-amber text-[10px]">Token pending</span>}
                <span className="text-text-muted ml-auto">{s.uptime_s}s</span>
                {s.auto_close_in > 0 && (
                  <span className="text-accent-red text-[10px]">closing in {Math.floor(s.auto_close_in / 60)}m {s.auto_close_in % 60}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Redis Queue */}
      {data && Object.keys(data.queue_detail).length > 0 && (
        <div className="glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-2">
              <Database size={14} className="text-accent-amber" />
              Redis Queue ({data.queue_length} total)
            </h3>
            <button
              onClick={async () => {
                if (confirm("Flush all queued items? They will be lost.")) {
                  await flushRedisQueues();
                  load();
                }
              }}
              className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              Flush All
            </button>
          </div>
          <div className="space-y-3">
            {Object.entries(data.queue_detail).map(([model, q]) => (
              <div key={model} className="rounded-lg bg-bg-primary/50 border border-border/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ListOrdered size={12} className="text-accent-violet" />
                    <span className="text-xs font-semibold text-text-secondary">{model}</span>
                  </div>
                  <span className="text-xs font-mono text-accent-amber">{q.size} waiting</span>
                </div>
                {q.items.length > 0 ? (
                  <div className="space-y-1">
                    {q.items.map((item, i) => (
                      <div key={item.full_id} className="flex items-center gap-2 px-2 py-1 rounded bg-bg-primary/30 text-[11px]">
                        <span className="text-text-muted font-mono w-4 text-right">#{i + 1}</span>
                        <span className="text-text-secondary font-mono">{item.request_id}</span>
                        <span className="text-text-muted ml-auto">
                          {item.age_s < 60 ? `${item.age_s}s ago` : `${Math.floor(item.age_s / 60)}m ${item.age_s % 60}s ago`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-text-muted">Empty</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {data && Object.keys(data.queue_detail).length === 0 && data.queue_length === 0 && (
        <div className="glass rounded-xl p-4">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-2">
            <Database size={14} className="text-text-muted" />
            Redis Queue
          </h3>
          <p className="text-xs text-text-muted">Queue is empty</p>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { key: "active", label: "Active", count: stats?.active },
          { key: "completed", label: "Completed", count: stats?.completed },
          { key: "failed", label: "Failed", count: stats?.failed },
          { key: "all", label: "All", count: stats?.total },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === key
                ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                : "text-text-muted hover:text-text-secondary border border-transparent"
            }`}
          >
            {label}
            {count !== undefined && <span className="ml-1.5 font-mono opacity-60">{count}</span>}
          </button>
        ))}
      </div>

      {/* Request cards */}
      {loading && !data ? (
        <div className="text-center py-12 text-text-muted">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
          Loading flow data...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No requests to show</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRequests.map((req) => (
            <RequestCard key={req.id} req={req} />
          ))}
        </div>
      )}
    </div>
  );
}
