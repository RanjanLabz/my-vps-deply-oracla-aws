"use client";

import { useEffect, useState } from "react";
import {
  Users,
  RefreshCw,
  Loader2,
  Lock,
  Unlock,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Key,
  Server,
  FolderOpen,
  ExternalLink,
  Shuffle,
  Target,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { API_BASE } from "@/lib/api";

interface Account {
  id: string;
  site: string;
  name: string;
  cookies: string;
  models: string;
  max_count: number;
  in_use: number;
  locked: number;
  status: string;
  project_mode: string;
  bound_project_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  name: string;
  account_id: string | null;
  created_at: string;
}

const EMPTY_FORM = {
  name: "",
  site: "labs.google",
  models: [] as string[],
  max_count: 1,
  cookies: "[  ]",
  project_mode: "RANDOM",
  bound_project_id: "" as string,
};

const MODEL_OPTIONS = [
  "NARWHAL",
  "GEM_PIX_2",
  "NANO_BANANA_2",
  "NANO_BANANA_PRO",
  "veo_3_1_i2v_lite_low_priority",
  "veo_3_1_r2v_fast_landscape_ultra_relaxed",
  "veo_3_1_upsampler_4k",
];

export default function AccountsPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [cookiesText, setCookiesText] = useState("");
  const [showCookies, setShowCookies] = useState(false);

  // Project management state
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [accountProjects, setAccountProjects] = useState<Record<string, Project[]>>({});
  const [showCreateProject, setShowCreateProject] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/accounts`);
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  };

  const loadProjects = async (accountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects?account_id=${accountId}`);
      const data = await res.json();
      setAccountProjects((prev) => ({ ...prev, [accountId]: Array.isArray(data) ? data : [] }));
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditingAccount(null);
    setForm({ ...EMPTY_FORM, models: [] });
    setCookiesText("[  ]");
    setShowForm(true);
  };

  const openEdit = (acc: Account) => {
    setEditingAccount(acc);
    let models: string[] = [];
    try { models = typeof acc.models === "string" ? JSON.parse(acc.models) : acc.models || []; } catch {}
    setForm({
      name: acc.name,
      site: acc.site,
      models,
      max_count: acc.max_count,
      cookies: acc.cookies,
      project_mode: acc.project_mode || "RANDOM",
      bound_project_id: acc.bound_project_id || "",
    });
    setCookiesText(acc.cookies || "[  ]");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast("error", "Account name is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        site: form.site,
        models: form.models,
        max_count: form.max_count,
        cookies: cookiesText,
        project_mode: form.project_mode,
        bound_project_id: form.project_mode === "BOUND" ? (form.bound_project_id || null) : null,
      };

      if (editingAccount) {
        const res = await fetch(`${API_BASE}/api/accounts/${editingAccount.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Update failed");
        }
        toast("success", "Account updated");
      } else {
        const res = await fetch(`${API_BASE}/api/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Create failed");
        }
        toast("success", "Account created");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast("success", "Account deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  };

  const handleLock = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/accounts/${id}/lock`, { method: "POST" });
      toast("success", "Account locked");
      load();
    } catch {}
  };

  const handleUnlock = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/accounts/${id}/unlock`, { method: "POST" });
      toast("success", "Account unlocked");
      load();
    } catch {}
  };

  const toggleModel = (model: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.includes(model)
        ? prev.models.filter((m) => m !== model)
        : [...prev.models, model],
    }));
  };

  const parseModels = (modelsStr: string): string[] => {
    try { return typeof modelsStr === "string" ? JSON.parse(modelsStr) : modelsStr || []; } catch { return []; }
  };

  const toggleExpand = async (accountId: string) => {
    if (expandedAccount === accountId) {
      setExpandedAccount(null);
    } else {
      setExpandedAccount(accountId);
      await loadProjects(accountId);
    }
  };

  const handleCreateProject = async (accountId: string) => {
    if (!newProjectName.trim()) {
      toast("error", "Project name is required");
      return;
    }
    setCreatingProject(true);
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accountId}/create-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newProjectName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Create failed");
      }
      toast("success", "Project created");
      setShowCreateProject(null);
      setNewProjectName("");
      await loadProjects(accountId);
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
    setCreatingProject(false);
  };

  const handleDeleteProject = async (projectId: string, accountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast("success", "Project deleted");
      setDeletingProject(null);
      await loadProjects(accountId);
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  };

  const handleVisitProject = async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/url`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        toast("error", "No URL found for this project");
      }
    } catch (e: any) {
      toast("error", e.message);
    }
  };

  const handleSetBoundProject = async (accountId: string, projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_mode: "BOUND", bound_project_id: projectId }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast("success", "Bound project updated");
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold gradient-text flex items-center gap-3">
              <Users className="w-10 h-10" />
              Accounts
            </h1>
            <p className="text-text-secondary mt-2 text-lg">
              Manage Google accounts, cookies, model access, and projects
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={load}
              className="px-4 py-2.5 rounded-xl glass hover:bg-[#1a1a2e] text-text-secondary hover:text-text-primary transition-all flex items-center gap-2 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={openAdd}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white font-semibold hover:opacity-90 transition-all flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Account
            </button>
          </div>
        </div>

        {/* Accounts List */}
        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="w-10 h-10 text-accent-violet animate-spin mx-auto mb-4" />
            <p className="text-text-secondary">Loading accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <Users className="w-20 h-20 text-text-muted mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">No accounts yet</h3>
            <p className="text-text-secondary mb-6">Add a Google account to start generating images and videos</p>
            <button
              onClick={openAdd}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white font-semibold hover:opacity-90 transition-all inline-flex items-center gap-2"
            >
              <Plus className="w-5 h-5" /> Add First Account
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((acc) => {
              const models = parseModels(acc.models);
              const isExpanded = expandedAccount === acc.id;
              const projects = accountProjects[acc.id] || [];
              return (
                <div key={acc.id} className="glass rounded-2xl p-6 hover:bg-[#0f0f1a]/50 transition-all">
                  {/* Top row: name + actions */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        acc.status === "ACTIVE" ? "bg-accent-emerald/20" : acc.status === "LOCKED" ? "bg-accent-amber/20" : "bg-accent-red/20"
                      }`}>
                        <Server className={`w-5 h-5 ${
                          acc.status === "ACTIVE" ? "text-accent-emerald" : acc.status === "LOCKED" ? "text-accent-amber" : "text-accent-red"
                        }`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-text-primary">{acc.name}</h3>
                        <p className="text-sm text-text-secondary">{acc.site}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        acc.status === "ACTIVE" ? "bg-accent-emerald/20 text-accent-emerald" :
                        acc.status === "LOCKED" ? "bg-accent-amber/20 text-accent-amber" :
                        "bg-accent-red/20 text-accent-red"
                      }`}>
                        {acc.status}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${
                        acc.project_mode === "BOUND" ? "bg-accent-cyan/20 text-accent-cyan" : "bg-accent-violet/20 text-accent-violet"
                      }`}>
                        {acc.project_mode === "BOUND" ? <Target className="w-3 h-3" /> : <Shuffle className="w-3 h-3" />}
                        {acc.project_mode || "RANDOM"}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="p-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a]">
                      <p className="text-xs text-text-muted mb-1">In Use</p>
                      <p className="text-xl font-bold text-text-primary">
                        {acc.in_use ?? 0}
                        <span className="text-sm text-text-muted">/{acc.max_count}</span>
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a]">
                      <p className="text-xs text-text-muted mb-1">Locked</p>
                      <div className="flex items-center gap-1.5">
                        {acc.locked ? (
                          <Lock className="w-5 h-5 text-accent-amber" />
                        ) : (
                          <Unlock className="w-5 h-5 text-accent-emerald" />
                        )}
                        <span className="text-sm font-medium text-text-primary">{acc.locked ? "Yes" : "No"}</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] col-span-2">
                      <p className="text-xs text-text-muted mb-1.5">Models</p>
                      <div className="flex flex-wrap gap-1.5">
                        {models.map((m) => (
                          <span key={m} className="px-2 py-0.5 rounded-full text-xs bg-accent-violet/10 text-accent-violet border border-accent-violet/20 font-mono">
                            {m}
                          </span>
                        ))}
                        {models.length === 0 && <span className="text-text-muted text-xs">No models</span>}
                      </div>
                    </div>
                  </div>

                  {/* Project Mode + Bound Project */}
                  <div className="mb-3 p-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a]">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-text-muted">Bound Project</p>
                      {acc.project_mode === "BOUND" && acc.bound_project_id && (
                        <button
                          onClick={() => handleVisitProject(acc.bound_project_id!)}
                          className="text-xs text-accent-cyan hover:text-accent-cyan/80 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" /> Visit
                        </button>
                      )}
                    </div>
                    {acc.project_mode === "BOUND" && acc.bound_project_id ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20 font-mono">
                        {acc.bound_project_id.slice(0, 12)}...
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted">
                        {acc.project_mode === "BOUND" ? "No project bound" : "Random mode - picks from projects below"}
                      </span>
                    )}
                  </div>

                  {/* Projects Section */}
                  <div className="mb-3">
                    <button
                      onClick={() => toggleExpand(acc.id)}
                      className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors w-full text-left"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Projects ({projects.length})
                      <span className="ml-auto text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 space-y-2">
                        {projects.length === 0 ? (
                          <p className="text-xs text-text-muted pl-6">No projects yet</p>
                        ) : (
                          projects.map((proj) => (
                            <div key={proj.id} className="flex items-center justify-between pl-6 py-2 px-3 rounded-lg bg-[#0a0a0f] border border-[#1a1a2e]">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-text-primary">{proj.name}</span>
                                <span className="text-xs text-text-muted font-mono">({proj.id.slice(0, 8)}...)</span>
                                {acc.bound_project_id === proj.id && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-cyan/20 text-accent-cyan">BOUND</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleVisitProject(proj.id)}
                                  className="p-1.5 rounded-lg hover:bg-accent-cyan/10 text-accent-cyan transition-all"
                                  title="Visit project"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                {acc.project_mode === "RANDOM" && acc.bound_project_id !== proj.id && (
                                  <button
                                    onClick={() => handleSetBoundProject(acc.id, proj.id)}
                                    className="p-1.5 rounded-lg hover:bg-accent-violet/10 text-accent-violet transition-all"
                                    title="Set as bound project"
                                  >
                                    <Target className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {deletingProject === proj.id ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleDeleteProject(proj.id, acc.id)}
                                      className="px-2 py-1 rounded bg-accent-red text-white text-[10px]"
                                    >
                                      Yes
                                    </button>
                                    <button
                                      onClick={() => setDeletingProject(null)}
                                      className="px-2 py-1 rounded bg-[#2a2a4a] text-text-secondary text-[10px]"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setDeletingProject(proj.id)}
                                    className="p-1.5 rounded-lg hover:bg-accent-red/10 text-accent-red transition-all"
                                    title="Delete project"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}

                        {/* Create Project */}
                        {showCreateProject === acc.id ? (
                          <div className="flex items-center gap-2 pl-6 mt-2">
                            <input
                              value={newProjectName}
                              onChange={(e) => setNewProjectName(e.target.value)}
                              placeholder="Project name"
                              className="flex-1 px-3 py-1.5 rounded-lg bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50"
                              onKeyDown={(e) => e.key === "Enter" && handleCreateProject(acc.id)}
                              autoFocus
                            />
                            <button
                              onClick={() => handleCreateProject(acc.id)}
                              disabled={creatingProject || !newProjectName.trim()}
                              className="px-3 py-1.5 rounded-lg bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 text-xs font-medium disabled:opacity-50"
                            >
                              {creatingProject ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => { setShowCreateProject(null); setNewProjectName(""); }}
                              className="px-3 py-1.5 rounded-lg bg-[#2a2a4a] text-text-secondary text-xs"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowCreateProject(acc.id)}
                            className="flex items-center gap-2 text-xs text-accent-violet hover:text-accent-violet/80 pl-6 mt-2 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Create Project
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#2a2a4a]">
                    <span className="text-xs text-text-muted font-mono">ID: {acc.id.slice(0, 16)}...</span>
                    <div className="flex items-center gap-2">
                      {acc.locked ? (
                        <button
                          onClick={() => handleUnlock(acc.id)}
                          className="px-3 py-1.5 rounded-lg bg-accent-emerald/10 text-accent-emerald hover:bg-accent-emerald/20 transition-all flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Unlock className="w-3.5 h-3.5" /> Unlock
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLock(acc.id)}
                          className="px-3 py-1.5 rounded-lg bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20 transition-all flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Lock className="w-3.5 h-3.5" /> Lock
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(acc)}
                        className="px-3 py-1.5 rounded-lg bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-all flex items-center gap-1.5 text-xs font-medium"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      {deleting === acc.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDelete(acc.id)}
                            className="px-3 py-1.5 rounded-lg bg-accent-red text-white text-xs font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleting(null)}
                            className="px-3 py-1.5 rounded-lg bg-[#2a2a4a] text-text-secondary text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleting(acc.id)}
                          className="px-3 py-1.5 rounded-lg bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-all flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[#2a2a4a]" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-[#2a2a4a]">
              <h2 className="text-xl font-bold text-text-primary">
                {editingAccount ? "Edit Account" : "Add Account"}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-[#1a1a2e] text-text-muted hover:text-text-primary transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Account Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Main Account"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 transition-all"
                />
              </div>

              {/* Site */}
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Site</label>
                <input
                  value={form.site}
                  onChange={(e) => setForm({ ...form, site: e.target.value })}
                  placeholder="labs.google"
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 transition-all"
                />
              </div>

              {/* Max Count */}
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Max Concurrent</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.max_count}
                  onChange={(e) => setForm({ ...form, max_count: parseInt(e.target.value) || 1 })}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary focus:outline-none focus:border-accent-violet/50 transition-all"
                />
              </div>

              {/* Project Mode */}
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Project Mode</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setForm({ ...form, project_mode: "RANDOM", bound_project_id: "" })}
                    className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      form.project_mode === "RANDOM"
                        ? "bg-accent-violet/20 border-accent-violet/40 text-accent-violet"
                        : "bg-[#0f0f1a] border-[#2a2a4a] text-text-secondary hover:border-accent-violet/30"
                    }`}
                  >
                    <Shuffle className="w-4 h-4" /> Random
                  </button>
                  <button
                    onClick={() => setForm({ ...form, project_mode: "BOUND" })}
                    className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      form.project_mode === "BOUND"
                        ? "bg-accent-cyan/20 border-accent-cyan/40 text-accent-cyan"
                        : "bg-[#0f0f1a] border-[#2a2a4a] text-text-secondary hover:border-accent-cyan/30"
                    }`}
                  >
                    <Target className="w-4 h-4" /> Bound
                  </button>
                </div>
                <p className="text-xs text-text-muted mt-1.5">
                  Random: picks any project from this account. Bound: uses only the selected project.
                </p>
              </div>

              {/* Models */}
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">Models</label>
                <div className="flex flex-wrap gap-2">
                  {MODEL_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => toggleModel(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                        form.models.includes(m)
                          ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                          : "bg-[#0f0f1a] text-text-secondary border border-[#2a2a4a] hover:border-accent-violet/30"
                      }`}
                    >
                      {form.models.includes(m) && <Check className="w-3 h-3 inline mr-1" />}
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cookies */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <Key className="w-4 h-4 text-accent-amber" />
                    Cookies (JSON)
                  </label>
                  <button
                    onClick={() => setShowCookies(!showCookies)}
                    className="text-xs text-accent-cyan hover:text-accent-cyan/80 transition-colors"
                  >
                    {showCookies ? "Hide" : "Show"}
                  </button>
                </div>
                <textarea
                  value={cookiesText}
                  onChange={(e) => setCookiesText(e.target.value)}
                  placeholder='[{"name": "...", "value": "...", "domain": "..."}]'
                  rows={showCookies ? 8 : 3}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 transition-all font-mono text-xs resize-none"
                />
                <p className="text-xs text-text-muted mt-1">
                  Paste cookies from browser DevTools → Application → Cookies
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-[#2a2a4a]">
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink text-white font-semibold hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2 text-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingAccount ? "Save Changes" : "Create Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
