"use client";

import { useEffect, useState } from "react";
import {
  ImagePlus,
  Video,
  FolderOpen,
  Users,
  Activity,
  TrendingUp,
  Zap,
  Clock,
} from "lucide-react";
import { API_BASE } from "@/lib/api";

interface HealthData {
  extension_connected: boolean;
  ws?: { connects: number; disconnects: number; uptime_s?: number };
}

interface Stats {
  totalProjects: number;
  totalAccounts: number;
  pendingRequests: number;
  processingRequests: number;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  glow,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  glow: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 hover:bg-bg-card-hover/50 transition-all duration-300 group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary mb-1">{label}</p>
          <p className="text-3xl font-bold text-text-primary">{value}</p>
        </div>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalProjects: 0,
    totalAccounts: 0,
    pendingRequests: 0,
    processingRequests: 0,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const h = await fetch(`${API_BASE}/health`).then((r) =>
          r.json()
        );
        setHealth(h);
      } catch {}
      try {
        const a = await fetch(`${API_BASE}/api/accounts`).then((r) =>
          r.json()
        );
        setAccounts(Array.isArray(a) ? a : []);
        setStats((s) => ({ ...s, totalAccounts: Array.isArray(a) ? a.length : 0 }));
      } catch {}
      try {
        const p = await fetch(`${API_BASE}/api/projects`).then((r) =>
          r.json()
        );
        setStats((s) => ({
          ...s,
          totalProjects: Array.isArray(p) ? p.length : 0,
        }));
      } catch {}
      try {
        const r = await fetch(
          `${API_BASE}/api/requests?limit=100`
        ).then((r) => r.json());
        const reqs = Array.isArray(r) ? r : [];
        setStats((s) => ({
          ...s,
          pendingRequests: reqs.filter((x: any) => x.status === "PENDING").length,
          processingRequests: reqs.filter((x: any) => x.status === "PROCESSING")
            .length,
        }));
      } catch {}
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const connected = health?.extension_connected ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Dashboard</h1>
        <p className="text-text-secondary mt-1">
          Flow Kit AI Creative Studio overview
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Extension"
          value={connected ? "Online" : "Offline"}
          icon={Zap}
          color={
            connected
              ? "bg-gradient-to-br from-accent-emerald to-accent-cyan"
              : "bg-gradient-to-br from-accent-red to-accent-pink"
          }
          glow={connected ? "glow-violet" : ""}
        />
        <StatCard
          label="Projects"
          value={stats.totalProjects}
          icon={FolderOpen}
          color="bg-gradient-to-br from-accent-violet to-accent-pink"
          glow=""
        />
        <StatCard
          label="Accounts"
          value={stats.totalAccounts}
          icon={Users}
          color="bg-gradient-to-br from-accent-cyan to-accent-emerald"
          glow=""
        />
        <StatCard
          label="Queue"
          value={stats.pendingRequests + stats.processingRequests}
          icon={Activity}
          color="bg-gradient-to-br from-accent-amber to-accent-red"
          glow=""
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5 lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-accent-violet" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="/generate/image"
              className="flex items-center gap-3 p-4 rounded-xl bg-bg-card/50 hover:bg-accent-violet/10 border border-border hover:border-accent-violet/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-violet to-accent-pink flex items-center justify-center group-hover:scale-110 transition-transform">
                <ImagePlus className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-medium">Generate Image</p>
                <p className="text-xs text-text-muted">Create AI images</p>
              </div>
            </a>
            <a
              href="/generate/video"
              className="flex items-center gap-3 p-4 rounded-xl bg-bg-card/50 hover:bg-accent-cyan/10 border border-border hover:border-accent-cyan/30 transition-all group"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent-cyan to-accent-emerald flex items-center justify-center group-hover:scale-110 transition-transform">
                <Video className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-medium">Generate Video</p>
                <p className="text-xs text-text-muted">Create AI videos</p>
              </div>
            </a>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-accent-amber" />
            Accounts
          </h3>
          <div className="space-y-3">
            {accounts.length === 0 && (
              <p className="text-sm text-text-muted">No accounts found</p>
            )}
            {accounts.slice(0, 5).map((acc: any) => (
              <div
                key={acc.id}
                className="flex items-center justify-between p-3 rounded-lg bg-bg-card/50"
              >
                <div>
                  <p className="text-sm font-medium truncate max-w-[140px]">
                    {acc.name || acc.id?.slice(0, 8)}
                  </p>
                  <p className="text-xs text-text-muted">
                    {acc.site?.replace("https://", "")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      acc.status === "ACTIVE" ? "bg-accent-emerald" : "bg-accent-red"
                    }`}
                  />
                  <span className="text-xs text-text-muted">
                    {acc.in_use ?? 0}/{acc.max_count ?? 1}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
