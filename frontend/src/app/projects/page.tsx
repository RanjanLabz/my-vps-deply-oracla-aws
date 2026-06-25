"use client";

import { useEffect, useState } from "react";
import {
  FolderOpen,
  Plus,
  Loader2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { API_BASE } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMaterial, setNewMaterial] = useState("realistic");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await fetch(`${API_BASE}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, material: newMaterial }),
      });
      setNewTitle("");
      setShowCreate(false);
      load();
    } catch {}
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-text flex items-center gap-3">
            <FolderOpen className="w-8 h-8" />
            Projects
          </h1>
          <p className="text-text-secondary mt-1">
            Manage your creative projects
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl glass hover:bg-bg-card-hover/50 text-text-secondary hover:text-text-primary transition-all flex items-center gap-2 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white text-sm font-medium hover:opacity-90 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Project Title
              </label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="My Creative Project"
                className="w-full px-4 py-2.5 rounded-xl bg-bg-primary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Material
              </label>
              <select
                value={newMaterial}
                onChange={(e) => setNewMaterial(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-bg-primary border border-border text-text-primary focus:outline-none focus:border-accent-violet/50 transition-all"
              >
                <option value="realistic">Realistic</option>
                <option value="3d_pixar">3D Pixar</option>
                <option value="anime">Anime</option>
                <option value="cartoon">Cartoon</option>
                <option value="oil_painting">Oil Painting</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newTitle.trim()}
            className="px-6 py-2 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create
          </button>
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No projects yet. Create your first project!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <div
              key={p.id}
              className="glass rounded-2xl p-5 hover:bg-bg-card-hover/50 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-text-primary group-hover:text-accent-violet transition-colors">
                  {p.title || p.name || "Untitled"}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    p.status === "ACTIVE"
                      ? "bg-accent-emerald/10 text-accent-emerald"
                      : "bg-accent-red/10 text-accent-red"
                  }`}
                >
                  {p.status || "ACTIVE"}
                </span>
              </div>
              <div className="space-y-2 text-sm text-text-secondary">
                <p>
                  ID: <span className="font-mono text-xs">{p.id?.slice(0, 12)}...</span>
                </p>
                {p.material && <p>Material: {p.material}</p>}
                {p.user_paygate_tier && (
                  <p>
                    Tier: {p.user_paygate_tier.replace("PAYGATE_TIER_", "")}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
