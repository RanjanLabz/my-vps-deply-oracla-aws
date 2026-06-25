"use client";

import { useState, useEffect, useCallback } from "react";
import {
  History,
  Image as ImageIcon,
  Video,
  XCircle,
  Download,
  Clock,
  Filter,
  Loader2,
  ExternalLink,
  Users,
  Monitor,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const API = API_BASE;

interface Request {
  id: string;
  type: string;
  status: string;
  media_id: string | null;
  output_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  account_id: string | null;
  chrome_pid: number | null;
}

type FilterType = "ALL" | "IMAGES" | "VIDEOS" | "FAILED";

const TYPE_LABELS: Record<string, string> = {
  GENERATE_IMAGE: "Image",
  REGENERATE_IMAGE: "Image",
  EDIT_IMAGE: "Image",
  GENERATE_CHARACTER_IMAGE: "Character",
  REGENERATE_CHARACTER_IMAGE: "Character",
  EDIT_CHARACTER_IMAGE: "Character",
  GENERATE_VIDEO: "Video",
  REGENERATE_VIDEO: "Video",
  GENERATE_VIDEO_REFS: "Video Refs",
  UPSCALE_VIDEO: "Upscale",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-accent-emerald/20 text-accent-emerald",
  FAILED: "bg-accent-red/20 text-accent-red",
  PROCESSING: "bg-accent-violet/20 text-accent-violet",
  PENDING: "bg-accent-amber/20 text-accent-amber",
};

const IMAGE_TYPES = [
  "GENERATE_IMAGE", "REGENERATE_IMAGE", "EDIT_IMAGE",
  "GENERATE_CHARACTER_IMAGE", "REGENERATE_CHARACTER_IMAGE", "EDIT_CHARACTER_IMAGE",
];
const VIDEO_TYPES = ["GENERATE_VIDEO", "REGENERATE_VIDEO", "GENERATE_VIDEO_REFS", "UPSCALE_VIDEO"];

export default function HistoryPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("ALL");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/accounts`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const map: Record<string, string> = {};
        data.forEach((a: any) => { map[a.id] = a.name; });
        setAccounts(map);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadAccounts();
    fetchRequests();
  }, [loadAccounts]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/requests?limit=100`);
      if (res.ok) {
        const data = await res.json();
        const items = data.value || data;
        setRequests(items);
      }
    } catch (e) {
      console.error("Failed to fetch requests:", e);
    }
    setLoading(false);
  };

  const filtered = requests.filter((r) => {
    if (filter === "IMAGES") return IMAGE_TYPES.includes(r.type) && r.status === "COMPLETED";
    if (filter === "VIDEOS") return VIDEO_TYPES.includes(r.type) && r.status === "COMPLETED";
    if (filter === "FAILED") return r.status === "FAILED";
    return true;
  });

  const completedCount = requests.filter((r) => r.status === "COMPLETED").length;
  const failedCount = requests.filter((r) => r.status === "FAILED").length;
  const imageCount = requests.filter((r) => IMAGE_TYPES.includes(r.type) && r.status === "COMPLETED").length;
  const videoCount = requests.filter((r) => VIDEO_TYPES.includes(r.type) && r.status === "COMPLETED").length;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold gradient-text flex items-center gap-3">
              <History className="w-10 h-10" />
              Generation History
            </h1>
            <p className="text-text-secondary mt-2 text-lg">
              Browse all your generated images and videos
            </p>
          </div>
          <button
            onClick={fetchRequests}
            className="px-4 py-2 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all flex items-center gap-2"
          >
            <Loader2 className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="glass rounded-xl p-4">
            <div className="text-2xl font-bold text-text-primary">{requests.length}</div>
            <div className="text-sm text-text-secondary">Total Requests</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-2xl font-bold text-accent-emerald">{completedCount}</div>
            <div className="text-sm text-text-secondary">Completed</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-2xl font-bold text-accent-violet">{imageCount}</div>
            <div className="text-sm text-text-secondary">Images</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-2xl font-bold text-accent-pink">{videoCount}</div>
            <div className="text-sm text-text-secondary">Videos</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(["ALL", "IMAGES", "VIDEOS", "FAILED"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                filter === f
                  ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                  : "bg-[#1a1a2e] text-text-secondary hover:text-text-primary border border-transparent"
              }`}
            >
              {f === "ALL" && <Filter className="w-4 h-4" />}
              {f === "IMAGES" && <ImageIcon className="w-4 h-4" />}
              {f === "VIDEOS" && <Video className="w-4 h-4" />}
              {f === "FAILED" && <XCircle className="w-4 h-4" />}
              {f}
              {f === "ALL" && ` (${requests.length})`}
              {f === "IMAGES" && ` (${imageCount})`}
              {f === "VIDEOS" && ` (${videoCount})`}
              {f === "FAILED" && ` (${failedCount})`}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-accent-violet animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <ImageIcon className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              No generations yet
            </h3>
            <p className="text-text-secondary">
              {filter === "ALL"
                ? "Generate your first image to see it here"
                : `No ${filter.toLowerCase()} to display`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((req) => (
              <div
                key={req.id}
                className="glass rounded-xl overflow-hidden group hover:border-accent-violet/30 transition-all"
              >
                {/* Thumbnail */}
                {req.output_url && IMAGE_TYPES.includes(req.type) ? (
                  <div
                    className="relative aspect-square cursor-pointer"
                    onClick={() => setPreviewImage(req.output_url!)}
                  >
                    <img
                      src={req.output_url}
                      alt={TYPE_LABELS[req.type] || req.type}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ExternalLink className="w-8 h-8 text-white" />
                    </div>
                  </div>
                ) : req.output_url && VIDEO_TYPES.includes(req.type) ? (
                  <div className="relative aspect-square bg-[#0f0f1a] flex items-center justify-center">
                    <Video className="w-12 h-12 text-accent-pink" />
                    <a
                      href={req.output_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0"
                    />
                  </div>
                ) : req.status === "FAILED" ? (
                  <div className="aspect-square bg-accent-red/5 flex items-center justify-center">
                    <XCircle className="w-12 h-12 text-accent-red/50" />
                  </div>
                ) : (
                  <div className="aspect-square bg-[#0f0f1a] flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-text-muted animate-spin" />
                  </div>
                )}

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-text-primary">
                      {TYPE_LABELS[req.type] || req.type}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        STATUS_COLORS[req.status] || "bg-[#2a2a4a] text-text-muted"
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                  {req.account_id && (
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="flex items-center gap-1 text-accent-violet">
                        <Users className="w-3 h-3" />
                        {accounts[req.account_id] || req.account_id.slice(0, 8) + "..."}
                      </span>
                      {req.chrome_pid && (
                        <span className="flex items-center gap-1 text-accent-cyan">
                          <Monitor className="w-3 h-3" />
                          {req.chrome_pid}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <Clock className="w-3 h-3" />
                    {formatDate(req.created_at)}
                  </div>
                  {req.error_message && (
                    <p className="text-xs text-accent-red mt-1 truncate">
                      {req.error_message}
                    </p>
                  )}
                  {req.output_url && (
                    <a
                      href={req.output_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-1 text-xs text-accent-violet hover:text-accent-pink transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full Size Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors"
            onClick={() => setPreviewImage(null)}
          >
            <XCircle className="w-8 h-8" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={previewImage}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-6 right-6 px-6 py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="w-5 h-5" />
            Download
          </a>
        </div>
      )}
    </div>
  );
}
