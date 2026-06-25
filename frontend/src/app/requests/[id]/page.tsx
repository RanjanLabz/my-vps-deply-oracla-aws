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
  Info,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const API = API_BASE;

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
  PROCESSING: "bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30",
  COMPLETED: "bg-accent-emerald/10 text-accent-emerald border-accent-emerald/30",
  FAILED: "bg-accent-red/10 text-accent-red border-accent-red/30",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  PENDING: Clock,
  PROCESSING: Cog,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
};

const EVENT_DOT_COLORS: Record<string, string> = {
  created: "bg-violet-500",
  dequeued: "bg-violet-400",
  account_acquired: "bg-cyan-500",
  account_skipped: "bg-zinc-500",
  account_capacity: "bg-amber-500",
  account_failed: "bg-red-500",
  project_resolved: "bg-cyan-400",
  project_none: "bg-zinc-500",
  chrome_launched: "bg-emerald-500",
  chrome_reused: "bg-emerald-400",
  chrome_max_profiles: "bg-amber-500",
  cookie_injected: "bg-emerald-400",
  auth_captured: "bg-emerald-500",
  auth_reused: "bg-emerald-400",
  auth_failed: "bg-red-500",
  processing_started: "bg-cyan-500",
  api_call: "bg-blue-500",
  api_success: "bg-emerald-500",
  storage_upload: "bg-emerald-400",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  failed_auth: "bg-red-500",
  retry: "bg-amber-500",
  deferred: "bg-amber-400",
  prereq_missing: "bg-amber-400",
};

const EVENT_DOT_SUCCESS = ["completed", "api_success", "auth_captured", "chrome_launched", "chrome_reused", "account_acquired", "project_resolved", "storage_upload"];
const EVENT_DOT_ERROR = ["failed", "failed_auth", "auth_failed", "account_failed"];
const EVENT_DOT_WARNING = ["retry", "deferred", "chrome_max_profiles", "account_capacity", "account_skipped"];

interface RequestEvent {
  id: string;
  request_id: string;
  event_type: string;
  message: string;
  why: string | null;
  details: string | null;
  created_at: string;
  label: string;
}

interface RequestDetail {
  id: string;
  type: string;
  status: string;
  project_id: string | null;
  account_id: string | null;
  chrome_pid: number | null;
  media_id: string | null;
  output_url: string | null;
  error_message: string | null;
  progress_pct: number;
  progress_stage: string;
  retry_count: number;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

function EventDot({ eventType }: { eventType: string }) {
  const color = EVENT_DOT_COLORS[eventType] || "bg-zinc-500";
  return (
    <div className={`w-3 h-3 rounded-full ${color} ring-2 ring-zinc-900 z-10 flex-shrink-0`} />
  );
}

function EventCard({ event, isLast }: { event: RequestEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = event.details || event.why;

  return (
    <div className="flex gap-4 relative">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[7px] top-4 w-[2px] h-[calc(100%-4px)] bg-zinc-700/50" />
      )}

      {/* Dot */}
      <div className="pt-1.5 flex-shrink-0">
        <EventDot eventType={event.event_type} />
      </div>

      {/* Content */}
      <div className={`flex-1 pb-6 ${isLast ? "" : ""}`}>
        <button
          onClick={() => hasDetails && setExpanded(!expanded)}
          className={`w-full text-left ${hasDetails ? "cursor-pointer hover:bg-zinc-800/30 rounded-lg p-2 -m-2 transition-colors" : ""}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-zinc-300 font-medium text-sm">{event.label}</span>
                <span className="text-zinc-500 text-xs font-mono">
                  {new Date(event.created_at).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    fractionalSecondDigits: 3,
                  })}
                </span>
              </div>
              <p className="text-zinc-400 text-sm mt-0.5 leading-relaxed">{event.message}</p>
            </div>
            {hasDetails && (
              <div className="text-zinc-600 flex-shrink-0 mt-1">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            )}
          </div>
        </button>

        {/* Expanded: why + details */}
        {expanded && hasDetails && (
          <div className="ml-2 mt-2 space-y-2">
            {event.why && (
              <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Info size={12} className="text-zinc-500" />
                  <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Why this happened</span>
                </div>
                <p className="text-zinc-300 text-sm leading-relaxed">{event.why}</p>
              </div>
            )}
            {event.details && (
              <div className="bg-zinc-800/30 rounded-lg p-3 border border-zinc-700/30">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Cog size={12} className="text-zinc-500" />
                  <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Technical Details</span>
                </div>
                <pre className="text-zinc-400 text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(event.details), null, 2);
                    } catch {
                      return event.details;
                    }
                  })()}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestHeader({ request, events }: { request: RequestDetail; events: RequestEvent[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  const StatusIcon = STATUS_ICONS[request.status] || Clock;
  const statusColor = STATUS_COLORS[request.status] || "bg-zinc-500/10 text-zinc-500";

  // Calculate duration from first to last event
  let duration = "";
  if (events.length >= 2) {
    const first = new Date(events[0].created_at).getTime();
    const last = new Date(events[events.length - 1].created_at).getTime();
    const secs = ((last - first) / 1000).toFixed(1);
    duration = `${secs}s`;
  }

  // Parse payload for prompt
  let prompt = "";
  try {
    if (request.payload_json) {
      const payload = JSON.parse(request.payload_json);
      prompt = payload.prompt || "";
    }
  } catch {}

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 mb-6">
      {/* Top row: Type + Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-white text-lg font-semibold">{request.type.replace(/_/g, " ")}</h1>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor}`}>
            <StatusIcon size={12} />
            {request.status}
          </span>
          {duration && (
            <span className="text-zinc-500 text-xs font-mono">Duration: {duration}</span>
          )}
        </div>
      </div>

      {/* Prompt */}
      {prompt && (
        <div className="mb-4 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/30">
          <span className="text-zinc-500 text-xs font-medium uppercase tracking-wide">Prompt</span>
          <p className="text-zinc-300 text-sm mt-1">&quot;{prompt}&quot;</p>
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wide">Account</span>
          <p className="text-zinc-300 font-mono text-xs mt-0.5">{request.account_id ? request.account_id.slice(0, 8) : "—"}</p>
        </div>
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wide">Project</span>
          <p className="text-zinc-300 font-mono text-xs mt-0.5">{request.project_id ? request.project_id.slice(0, 8) : "—"}</p>
        </div>
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wide">Chrome PID</span>
          <p className="text-zinc-300 font-mono text-xs mt-0.5">{request.chrome_pid || "—"}</p>
        </div>
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wide">Retries</span>
          <p className="text-zinc-300 font-mono text-xs mt-0.5">{request.retry_count}</p>
        </div>
      </div>

      {/* Progress bar */}
      {request.progress_pct > 0 && request.progress_pct < 100 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400">{request.progress_stage || "Processing"}</span>
            <span className="text-zinc-500">{request.progress_pct}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className="bg-accent-cyan h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${request.progress_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {request.error_message && (
        <div className="mt-4 p-3 bg-accent-red/5 border border-accent-red/20 rounded-lg">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-accent-red" />
            <span className="text-accent-red text-xs font-medium">Error</span>
          </div>
          <p className="text-accent-red/80 text-sm">{request.error_message}</p>
        </div>
      )}

      {/* Output */}
      {request.status === "COMPLETED" && request.output_url && (
        <div className="mt-4 p-3 bg-accent-emerald/5 border border-accent-emerald/20 rounded-lg">
          <div className="flex items-center gap-1.5 mb-2">
            <ImageIcon size={12} className="text-accent-emerald" />
            <span className="text-accent-emerald text-xs font-medium">Output</span>
          </div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={request.output_url}
              alt="Generated"
              className="w-24 h-24 object-cover rounded-lg border border-zinc-700"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="flex-1 min-w-0">
              {request.media_id && (
                <p className="text-zinc-400 text-xs font-mono truncate">media_id: {request.media_id}</p>
              )}
              <a
                href={request.output_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent-cyan text-xs hover:underline mt-1"
              >
                Open full size <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* IDs */}
      <div className="mt-4 flex items-center gap-4 text-xs">
        <button
          onClick={() => copyToClipboard(request.id, "id")}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <span className="font-mono">ID: {request.id.slice(0, 12)}...</span>
          {copied === "id" ? <Check size={10} className="text-accent-emerald" /> : <Copy size={10} />}
        </button>
        <span className="text-zinc-600">|</span>
        <span className="text-zinc-600 font-mono">
          Created: {new Date(request.created_at).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/requests/${id}/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequest(data.request);
      setEvents(data.events || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 3s if still processing
    const interval = setInterval(() => {
      if (request?.status === "PENDING" || request?.status === "PROCESSING") {
        fetchData();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchData, request?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-zinc-500" size={32} />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <XCircle className="text-accent-red" size={48} />
        <p className="text-zinc-400 text-lg">{error || "Request not found"}</p>
        <button
          onClick={() => router.push("/requests")}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
        >
          Back to Requests
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => router.push("/requests")}
        className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors mb-6 group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Requests</span>
      </button>

      {/* Request header card */}
      <RequestHeader request={request} events={events} />

      {/* Timeline */}
      <div className="mb-6">
        <h2 className="text-zinc-300 font-semibold text-sm uppercase tracking-wide mb-4">
          Processing Timeline
        </h2>

        {events.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <Clock size={32} className="mx-auto mb-3 opacity-50" />
            <p>No events recorded yet</p>
          </div>
        ) : (
          <div className="pl-1">
            {events.map((event, i) => (
              <EventCard
                key={event.id}
                event={event}
                isLast={i === events.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
