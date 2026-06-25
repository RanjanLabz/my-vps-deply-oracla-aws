"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Cog,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Users,
  Monitor,
  Shield,
  ShieldOff,
  Zap,
  ZapOff,
  ExternalLink,
  Globe,
  Lock,
  Unlock,
  FolderOpen,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const API = API_BASE;

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
  PROCESSING: "bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30",
  COMPLETED: "bg-accent-emerald/10 text-accent-emerald border-accent-emerald/30",
  FAILED: "bg-accent-red/10 text-accent-red border-accent-red/30",
  ACTIVE: "bg-accent-emerald/10 text-accent-emerald border-accent-emerald/30",
  DISABLED: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
  LOCKED: "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  PENDING: Clock,
  PROCESSING: Cog,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
};

function RequestRow({ req, events, onClick }: { req: any; events?: any[]; onClick?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const StatusIcon = STATUS_ICONS[req.status] || Clock;
  const statusColor = STATUS_COLORS[req.status] || "bg-zinc-500/10 text-zinc-500";

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => onClick && onClick()}
        className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon size={16} className="text-zinc-400" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-300 font-medium text-sm">{req.type.replace(/_/g, " ")}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs border ${statusColor}`}>
                  {req.status}
                </span>
                {req.project_id && (
                  <span className="text-zinc-500 text-xs font-mono">proj:{req.project_id.slice(0, 8)}</span>
                )}
              </div>
              <p className="text-zinc-500 text-xs font-mono mt-0.5">{req.id.slice(0, 12)}...</p>
            </div>
          </div>
          <div className="text-right text-xs text-zinc-500">
            {req.progress_pct > 0 && req.progress_pct < 100 && (
              <p className="text-accent-cyan font-mono">{req.progress_pct}%</p>
            )}
            {req.error_message && (
              <p className="text-accent-red max-w-[200px] truncate">{req.error_message}</p>
            )}
            <p className="font-mono text-zinc-600">
              {new Date(req.created_at).toLocaleTimeString("en-US", { hour12: false })}
            </p>
          </div>
        </div>
      </button>

      {/* Events for this request */}
      {events && events.length > 0 && (
        <div className="border-t border-zinc-800/50">
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="w-full px-4 py-2 flex items-center gap-2 text-zinc-500 hover:text-zinc-400 text-xs transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {events.length} events
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-2">
              {events.map((ev: any) => (
                <div key={ev.id} className="flex gap-3 text-xs">
                  <span className="text-zinc-600 font-mono flex-shrink-0">
                    {new Date(ev.created_at).toLocaleTimeString("en-US", {
                      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
                    })}
                  </span>
                  <span className="text-zinc-400">{ev.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/requests/log/profiles/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-zinc-500" size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <XCircle className="text-accent-red" size={48} />
        <p className="text-zinc-400 text-lg">{error || "Profile not found"}</p>
        <button
          onClick={() => router.push("/requests")}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
        >
          Back to Requests
        </button>
      </div>
    );
  }

  const { account, chrome_session, stats, requests, request_events } = data;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.push("/requests")}
        className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors mb-6 group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Requests</span>
      </button>

      {/* Account Header Card */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-violet to-accent-pink flex items-center justify-center">
              <Users size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-white text-lg font-semibold">{account.name}</h1>
              <p className="text-zinc-500 text-xs font-mono">{account.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {account.locked ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-amber/10 text-accent-amber border border-accent-amber/30">
                <Lock size={12} /> Locked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/30">
                <Unlock size={12} /> {account.status}
              </span>
            )}
            <button
              onClick={() => copyToClipboard(account.id, "id")}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {copied === "id" ? <Check size={14} className="text-accent-emerald" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Account Info Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wide">Site</span>
            <p className="text-zinc-300 text-xs mt-0.5 flex items-center gap-1">
              <Globe size={10} /> {account.site}
            </p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wide">Models</span>
            <p className="text-zinc-300 text-xs mt-0.5">{account.models.join(", ") || "none"}</p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wide">Concurrency</span>
            <p className="text-zinc-300 text-xs mt-0.5">{account.in_use}/{account.max_count} slots</p>
          </div>
          <div>
            <span className="text-zinc-500 text-xs uppercase tracking-wide">Project Mode</span>
            <p className="text-zinc-300 text-xs mt-0.5">{account.project_mode}</p>
          </div>
        </div>

        {/* Bound Project */}
        {account.bound_project && (
          <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/30 mb-4">
            <div className="flex items-center gap-1.5 mb-1">
              <FolderOpen size={12} className="text-accent-violet" />
              <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Bound Project</span>
            </div>
            <p className="text-zinc-300 text-sm">{account.bound_project.name} <span className="text-zinc-500 font-mono text-xs">({account.bound_project.id.slice(0, 8)})</span></p>
          </div>
        )}

        {/* All Projects */}
        {account.projects && account.projects.length > 0 && (
          <div className="mb-4">
            <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">All Projects ({account.projects.length})</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {account.projects.map((p: any) => (
                <span key={p.id} className="px-2 py-1 bg-zinc-800/50 rounded-lg text-xs text-zinc-400 border border-zinc-700/30">
                  {p.name} <span className="text-zinc-600 font-mono">({p.id.slice(0, 6)})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Chrome Session */}
        {chrome_session ? (
          <div className="p-3 bg-accent-emerald/5 border border-accent-emerald/20 rounded-lg">
            <div className="flex items-center gap-1.5 mb-2">
              <Monitor size={12} className="text-accent-emerald" />
              <span className="text-accent-emerald text-xs font-medium">Chrome Session Active</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-zinc-500">PID</span>
                <p className="text-zinc-300 font-mono">{chrome_session.pid}</p>
              </div>
              <div>
                <span className="text-zinc-500">Port</span>
                <p className="text-zinc-300 font-mono">{chrome_session.port}</p>
              </div>
              <div>
                <span className="text-zinc-500">Uptime</span>
                <p className="text-zinc-300 font-mono">{chrome_session.uptime_s}s</p>
              </div>
              <div>
                <span className="text-zinc-500">Token</span>
                <p className={`font-mono ${chrome_session.has_token ? "text-accent-emerald" : "text-accent-red"}`}>
                  {chrome_session.has_token ? "Valid" : "None"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-zinc-800/30 border border-zinc-700/30 rounded-lg">
            <div className="flex items-center gap-1.5">
              <Monitor size={12} className="text-zinc-500" />
              <span className="text-zinc-500 text-xs">No active Chrome session</span>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Completed", value: stats.completed, color: "text-accent-emerald" },
          { label: "Failed", value: stats.failed, color: "text-accent-red" },
          { label: "Processing", value: stats.processing, color: "text-accent-cyan" },
          { label: "Pending", value: stats.pending, color: "text-accent-amber" },
        ].map((s) => (
          <div key={s.label} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-zinc-500 text-xs">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Request History */}
      <div>
        <h2 className="text-zinc-300 font-semibold text-sm uppercase tracking-wide mb-4">
          Request History ({requests.length})
        </h2>
        {requests.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <Clock size={32} className="mx-auto mb-3 opacity-50" />
            <p>No requests processed yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req: any) => (
              <RequestRow
                key={req.id}
                req={req}
                events={request_events[req.id]}
                onClick={() => router.push(`/requests/${req.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
