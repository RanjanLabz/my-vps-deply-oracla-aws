"use client";

import { useState } from "react";
import {
  BookOpen,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Zap,
  Image as ImageIcon,
  Video,
  FolderOpen,
  Users,
  Activity,
  Music,
  Settings,
  Server,
  Globe,
  ArrowRight,
  Layers,
  GitBranch,
  Clock,
  BarChart3,
  Database,
  Cpu,
  RefreshCw,
  Shield,
  Workflow,
  Terminal,
} from "lucide-react";

import { API_BASE } from "@/lib/api";

const BASE_URL = API_BASE;

type DocTab = "overview" | "architecture" | "progress" | "queue" | "routers" | "endpoints" | "errors";

interface Endpoint {
  method: string;
  path: string;
  title: string;
  description: string;
  requestExample?: string;
  responseExample?: string;
  notes?: string;
}

interface Section {
  id: string;
  title: string;
  icon: any;
  color: string;
  endpoints: Endpoint[];
}

const SECTIONS: Section[] = [
  {
    id: "health",
    title: "Health & Status",
    icon: Server,
    color: "text-accent-cyan",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        title: "Health Check",
        description: "Check server status and extension connection state.",
        responseExample: `{
  "status": "ok",
  "version": "0.2.0",
  "extension_connected": true,
  "ws": { "connected": true, "connects": 5 }
}`,
      },
      {
        method: "GET",
        path: "/api/flow/status",
        title: "Extension Status",
        description: "Check if the Chrome extension is connected and flowKey is present.",
        responseExample: `{
  "connected": true,
  "flow_key_present": true
}`,
      },
      {
        method: "GET",
        path: "/api/flow/credits",
        title: "Get Credits",
        description: "Retrieve remaining Google Flow credits for the active account.",
      },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    icon: FolderOpen,
    color: "text-accent-violet",
    endpoints: [
      {
        method: "POST",
        path: "/api/projects",
        title: "Create Project",
        description: "Create a new project with optional material and entities.",
        requestExample: `{
  "title": "My Documentary",
  "material": "realistic"
}`,
        responseExample: `{
  "id": "7da72340-6b98-...",
  "title": "My Documentary",
  "material": "realistic",
  "created_at": "2026-06-21T..."
}`,
      },
      { method: "GET", path: "/api/projects", title: "List Projects", description: "List all projects." },
      { method: "GET", path: "/api/projects/{pid}", title: "Get Project", description: "Get a single project by ID." },
      { method: "PATCH", path: "/api/projects/{pid}", title: "Update Project", description: "Update project fields." },
      { method: "DELETE", path: "/api/projects/{pid}", title: "Delete Project", description: "Delete a project and all its data." },
      { method: "POST", path: "/api/projects/{pid}/characters/{cid}", title: "Link Character", description: "Link a character to a project." },
      { method: "GET", path: "/api/projects/{pid}/characters", title: "Get Project Characters", description: "List all characters linked to a project." },
    ],
  },
  {
    id: "characters",
    title: "Characters",
    icon: Users,
    color: "text-accent-pink",
    endpoints: [
      { method: "POST", path: "/api/characters", title: "Create Character", description: "Create a new character with description and image prompt.",
        requestExample: `{
  "name": "Luna",
  "entity_type": "person",
  "description": "A young explorer with curious eyes",
  "image_prompt": "portrait of a young woman, adventurous look"
}`,
      },
      { method: "GET", path: "/api/characters", title: "List Characters", description: "List all characters." },
      { method: "GET", path: "/api/characters/{cid}", title: "Get Character", description: "Get a single character by ID." },
      { method: "PATCH", path: "/api/characters/{cid}", title: "Update Character", description: "Update character fields." },
      { method: "DELETE", path: "/api/characters/{cid}", title: "Delete Character", description: "Delete a character." },
    ],
  },
  {
    id: "videos-scenes",
    title: "Videos & Scenes",
    icon: Video,
    color: "text-accent-amber",
    endpoints: [
      { method: "POST", path: "/api/videos", title: "Create Video", description: "Create a video container for scenes.",
        requestExample: `{
  "project_id": "7da72340-...",
  "title": "Main Video",
  "orientation": "VERTICAL"
}`,
      },
      { method: "GET", path: "/api/videos", title: "List Videos", description: "List videos by project." },
      { method: "PATCH", path: "/api/videos/{vid}", title: "Update Video", description: "Update video metadata." },
      { method: "POST", path: "/api/scenes", title: "Create Scene", description: "Create a scene within a video.",
        requestExample: `{
  "video_id": "b882494d-...",
  "title": "Scene 1",
  "prompt": "Luna walking through a misty forest",
  "video_prompt": "0-3s: Luna walks forward. 3-6s: Camera pans up.",
  "character_names": ["Luna"],
  "chain_type": "start_end"
}`,
      },
      { method: "PATCH", path: "/api/scenes/{sid}", title: "Update Scene", description: "Update scene prompt, video_prompt, or other fields." },
      { method: "GET", path: "/api/scenes", title: "List Scenes", description: "List scenes by video_id." },
    ],
  },
  {
    id: "generation",
    title: "Image Generation",
    icon: ImageIcon,
    color: "text-accent-emerald",
    endpoints: [
      {
        method: "POST",
        path: "/api/flow/generate-image",
        title: "Generate Image",
        description: "Generate an AI image from a text prompt. Always queues to Redis when queue=true (recommended).",
        requestExample: `{
  "prompt": "A girl dancing in Pokhara city in a boat",
  "project_id": "default",
  "aspect_ratio": "IMAGE_ASPECT_RATIO_PORTRAIT",
  "queue": true
}`,
        responseExample: `{
  "queued": true,
  "request_id": "efad04cf-...",
  "position": 1,
  "model": "NARWHAL",
  "message": "Request queued. Will process when extension is ready."
}`,
        notes: "Always use queue=true. Returns instantly with request_id. Worker processes in background.",
      },
      {
        method: "POST",
        path: "/api/flow/edit-image",
        title: "Edit Image",
        description: "Edit an existing image using a source media_id and text prompt.",
        requestExample: `{
  "prompt": "Change the sky to night with stars",
  "source_media_id": "24dc0af9-cfde-...",
  "project_id": "default",
  "aspect_ratio": "IMAGE_ASPECT_RATIO_PORTRAIT"
}`,
        notes: "source_media_id must be a valid Google Flow media_id from a previous generation.",
      },
      {
        method: "POST",
        path: "/api/flow/edit-image-url",
        title: "Edit Image (URL)",
        description: "Edit an image using a URL as source. Downloads from URL, uploads to Google Flow, then edits. Always queues.",
        requestExample: `{
  "prompt": "Make it look like a painting",
  "source_url": "https://pub-d92aea5d...r2.dev/uploads/source/abc.jpg",
  "project_id": "default",
  "queue": true
}`,
        notes: "Best for UI integration. Works even when extension is offline.",
      },
      {
        method: "POST",
        path: "/api/flow/upload-image-base64",
        title: "Upload Image (Base64)",
        description: "Upload a base64-encoded image to R2. Returns permanent URL.",
        requestExample: `{
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "mime_type": "image/jpeg"
}`,
        responseExample: `{
  "source_url": "https://pub-d92aea5d...r2.dev/uploads/source/abc.jpg"
}`,
      },
    ],
  },
  {
    id: "video-gen",
    title: "Video Generation",
    icon: Video,
    color: "text-accent-pink",
    endpoints: [
      {
        method: "POST",
        path: "/api/flow/generate-video",
        title: "Generate Video (I2V)",
        description: "Generate a video from a start image and text prompt. Always queues.",
        requestExample: `{
  "start_image_url": "https://pub-d92aea5d...r2.dev/uploads/source/img.jpg",
  "prompt": "The character walks forward through the misty forest",
  "project_id": "default",
  "scene_id": "...",
  "aspect_ratio": "VIDEO_ASPECT_RATIO_PORTRAIT"
}`,
        notes: "Returns instantly with request_id. Video generation takes 2-5 minutes.",
      },
      {
        method: "POST",
        path: "/api/flow/generate-video-refs",
        title: "Generate Video (R2V)",
        description: "Generate a video from multiple reference images. Always queues.",
        requestExample: `{
  "reference_media_ids": ["url1", "url2"],
  "prompt": "The characters interact in the scene",
  "project_id": "default",
  "scene_id": "...",
  "aspect_ratio": "VIDEO_ASPECT_RATIO_PORTRAIT"
}`,
      },
      {
        method: "POST",
        path: "/api/flow/upscale-video",
        title: "Upscale Video",
        description: "Upscale a generated video to 4K resolution. Always queues.",
        requestExample: `{
  "media_id": "fb5ce2c6-d7e7-...",
  "scene_id": "...",
  "aspect_ratio": "VIDEO_ASPECT_RATIO_PORTRAIT",
  "resolution": "VIDEO_RESOLUTION_4K"
}`,
      },
    ],
  },
  {
    id: "requests",
    title: "Request Queue",
    icon: Activity,
    color: "text-accent-cyan",
    endpoints: [
      {
        method: "POST",
        path: "/api/requests/batch",
        title: "Submit Batch",
        description: "Submit multiple requests at once. Server handles throttling (max 5 concurrent, 10s cooldown).",
        requestExample: `{
  "requests": [
    {"type": "GENERATE_IMAGE", "scene_id": "...", "project_id": "...", "orientation": "VERTICAL"},
    {"type": "GENERATE_IMAGE", "scene_id": "...", "project_id": "...", "orientation": "VERTICAL"}
  ]
}`,
        notes: "NEVER write scripts to loop over API requests. Always use batch.",
      },
      {
        method: "GET",
        path: "/api/requests/batch-status",
        title: "Batch Status",
        description: "Get aggregate status for all requests matching a filter.",
        responseExample: `{
  "total": 40, "pending": 30, "processing": 5,
  "completed": 5, "failed": 0, "done": false
}`,
        notes: "When done=true, all requests have left the queue.",
      },
      {
        method: "GET",
        path: "/api/requests/{rid}",
        title: "Get Request (Poll This)",
        description: "Poll this endpoint to track request progress. Returns progress_pct and progress_stage.",
        responseExample: `{
  "id": "efad04cf-...",
  "status": "COMPLETED",
  "progress_pct": 100,
  "progress_stage": "Complete",
  "media_id": "24dc0af9-...",
  "output_url": "https://pub-d92aea5d...r2.dev/requests/efad04cf.jpg"
}`,
        notes: "Poll every 2-3 seconds. progress_pct goes 0→100. See Progress Tracking section.",
      },
      { method: "GET", path: "/api/requests", title: "List Requests", description: "List all requests with optional filters." },
    ],
  },
  {
    id: "storage",
    title: "Storage & Upload",
    icon: Globe,
    color: "text-accent-amber",
    endpoints: [
      {
        method: "POST",
        path: "/api/flow/upload-to-r2",
        title: "Upload to R2",
        description: "Upload a file from URL to Cloudflare R2 for permanent storage.",
        requestExample: `{
  "url": "https://flow-content.google/image/...",
  "key": "uploads/my-image.jpg"
}`,
        responseExample: `{
  "url": "https://pub-d92aea5d...r2.dev/uploads/my-image.jpg",
  "key": "uploads/my-image.jpg"
}`,
        notes: "All generated media are auto-uploaded to R2 by the worker.",
      },
      {
        method: "POST",
        path: "/api/flow/upload-image-url",
        title: "Upload Image (URL)",
        description: "Download image from URL and upload to Google Flow to get a media_id.",
        requestExample: `{
  "url": "https://example.com/photo.jpg",
  "project_id": "default"
}`,
        responseExample: `{
  "media_id": "24dc0af9-cfde-..."
}`,
      },
      {
        method: "GET",
        path: "/api/flow/media/{media_id}",
        title: "Get Media",
        description: "Get media metadata + fresh signed URL from Google Flow.",
        notes: "Use this to refresh expired GCS signed URLs.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    icon: Users,
    color: "text-accent-violet",
    endpoints: [
      { method: "GET", path: "/api/accounts", title: "List Accounts", description: "List all Google accounts with their status." },
      { method: "POST", path: "/api/accounts", title: "Create Account", description: "Add a new Google account with cookies.",
        requestExample: `{
  "site": "labs.google",
  "models": ["NARWHAL", "GEM_PIX_2"],
  "max_count": 1,
  "cookies": "[{...cookie JSON...}]"
}`,
      },
      { method: "PATCH", path: "/api/accounts/{account_id}", title: "Update Account", description: "Update account cookies or settings." },
      { method: "DELETE", path: "/api/accounts/{account_id}", title: "Delete Account", description: "Remove an account." },
    ],
  },
  {
    id: "defaults",
    title: "Default Models",
    icon: Settings,
    color: "text-accent-emerald",
    endpoints: [
      { method: "GET", path: "/api/defaults", title: "List Defaults", description: "List all default model assignments.",
        responseExample: `{
  "generate_image": "NANO_BANANA_2",
  "edit_image": "NANO_BANANA_2",
  "generate_video": "veo_3_1_i2v_lite_low_priority",
  "upscale_video": "veo_3_1_upsampler_4k"
}`,
      },
      { method: "PUT", path: "/api/defaults/{operation_type}", title: "Set Default", description: "Set default model for an operation type.",
        requestExample: `{ "model": "NANO_BANANA_PRO" }`,
        notes: "Types: generate_image, edit_image, generate_video, generate_video_refs, upscale_video",
      },
    ],
  },
  {
    id: "websocket",
    title: "WebSocket",
    icon: Zap,
    color: "text-accent-cyan",
    endpoints: [
      {
        method: "WS",
        path: "/ws/dashboard",
        title: "Dashboard WebSocket",
        description: "Real-time event stream for dashboard clients.",
        notes: "Events: request_update (id, status, type), worker_tick (active, slots, pending), urls_refreshed",
      },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-white/10 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-accent-emerald" /> : <Copy className="w-3.5 h-3.5 text-text-muted" />}
    </button>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [expanded, setExpanded] = useState(false);
  const methodColors: Record<string, string> = {
    GET: "bg-accent-emerald/20 text-accent-emerald",
    POST: "bg-accent-violet/20 text-accent-violet",
    PUT: "bg-accent-amber/20 text-accent-amber",
    PATCH: "bg-accent-cyan/20 text-accent-cyan",
    DELETE: "bg-accent-red/20 text-accent-red",
    WS: "bg-accent-pink/20 text-accent-pink",
  };

  return (
    <div className="glass rounded-xl overflow-hidden hover:border-accent-violet/20 transition-all">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-5 py-4 flex items-center gap-3 text-left">
        <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${methodColors[ep.method] || "bg-[#2a2a4a] text-text-muted"}`}>{ep.method}</span>
        <code className="text-sm text-text-primary font-mono flex-1">{ep.path}</code>
        <span className="text-sm text-text-secondary hidden md:block mr-2">{ep.title}</span>
        {expanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
      </button>
      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-[#2a2a4a]">
          <p className="text-text-secondary text-sm mt-3">{ep.description}</p>
          {ep.notes && <div className="p-3 rounded-lg bg-accent-amber/5 border border-accent-amber/20 text-sm text-accent-amber">{ep.notes}</div>}
          {ep.requestExample && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Request</span>
                <CopyButton text={ep.requestExample} />
              </div>
              <pre className="bg-[#0a0a0f] rounded-lg p-3 text-xs text-text-secondary overflow-x-auto border border-[#2a2a4a]">{ep.requestExample}</pre>
            </div>
          )}
          {ep.responseExample && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Response</span>
                <CopyButton text={ep.responseExample} />
              </div>
              <pre className="bg-[#0a0a0f] rounded-lg p-3 text-xs text-text-secondary overflow-x-auto border border-[#2a2a4a]">{ep.responseExample}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiagramBox({ title, color, children }: { title: string; color: string; children?: React.ReactNode }) {
  return (
    <div className={`glass rounded-xl p-4 border-l-4 ${color}`}>
      <h4 className="font-semibold text-text-primary text-sm mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Arrow({ label, color = "text-text-muted" }: { label: string; color?: string }) {
  return (
    <div className={`flex items-center justify-center py-1 ${color}`}>
      <div className="text-xs font-mono">{label}</div>
      <ArrowRight className="w-4 h-4 ml-1" />
    </div>
  );
}

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<DocTab>("overview");
  const [activeSection, setActiveSection] = useState("health");
  const [searchQuery, setSearchQuery] = useState("");

  const tabs: { key: DocTab; label: string; icon: any }[] = [
    { key: "overview", label: "Overview", icon: BookOpen },
    { key: "architecture", label: "Architecture", icon: Layers },
    { key: "progress", label: "Progress Tracking", icon: BarChart3 },
    { key: "queue", label: "Queue System", icon: Clock },
    { key: "routers", label: "Routers", icon: GitBranch },
    { key: "endpoints", label: "Endpoints", icon: Terminal },
    { key: "errors", label: "Errors", icon: Shield },
  ];

  const filteredSections = SECTIONS.map((section) => ({
    ...section,
    endpoints: section.endpoints.filter(
      (ep) =>
        ep.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.description.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((s) => s.endpoints.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold gradient-text flex items-center gap-3">
            <BookOpen className="w-10 h-10" />
            Flow Kit Documentation
          </h1>
          <p className="text-text-secondary mt-2 text-lg">
            Complete API reference, architecture, and integration guide
          </p>
          <div className="flex items-center gap-4 mt-4 text-sm">
            <div className="glass rounded-lg px-4 py-2">
              <span className="text-text-muted">Base URL:</span>{" "}
              <code className="text-accent-violet font-mono">{BASE_URL}</code>
            </div>
            <div className="glass rounded-lg px-4 py-2">
              <span className="text-text-muted">Auth:</span>{" "}
              <span className="text-accent-emerald">None (local)</span>
            </div>
            <div className="glass rounded-lg px-4 py-2">
              <span className="text-text-muted">Version:</span>{" "}
              <span className="text-accent-cyan">0.2.0</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-8 p-1 glass rounded-xl overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === t.key
                  ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                  : "text-text-secondary hover:text-text-primary hover:bg-[#1a1a2e]"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "architecture" && <ArchitectureTab />}
        {activeTab === "progress" && <ProgressTab />}
        {activeTab === "queue" && <QueueTab />}
        {activeTab === "routers" && <RoutersTab />}
        {activeTab === "endpoints" && (
          <EndpointsTab
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filteredSections={filteredSections}
            activeSection={activeSection}
            setActiveSection={setActiveSection}
          />
        )}
        {activeTab === "errors" && <ErrorsTab />}
      </div>
    </div>
  );
}

/* ─── Overview Tab ─────────────────────────────────────────── */

function OverviewTab() {
  return (
    <div className="space-y-6">
      {/* Quick Start */}
      <div className="glass rounded-2xl p-6 glow-violet">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-accent-violet" />
          Quick Start
        </h2>
        <div className="space-y-4">
          {[
            { step: 1, title: "Check health", code: "GET /health", desc: "Verify server and extension are running" },
            { step: 2, title: "Create a project", code: 'POST /api/projects { "title": "My Project", "material": "realistic" }', desc: "Projects group related media together" },
            { step: 3, title: "Generate an image", code: 'POST /api/flow/generate-image { "prompt": "...", "project_id": "...", "queue": true }', desc: "Returns instantly with request_id" },
            { step: 4, title: "Poll for progress", code: "GET /api/requests/{request_id}", desc: "Check every 2-3 seconds until status=COMPLETED" },
            { step: 5, title: "Get result", code: "output_url contains permanent R2 URL", desc: "Image is auto-uploaded to Cloudflare R2" },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-4 p-4 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a]">
              <span className="w-8 h-8 rounded-full bg-accent-violet/20 text-accent-violet flex items-center justify-center text-sm font-bold flex-shrink-0">
                {item.step}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-text-primary font-semibold">{item.title}</span>
                  <code className="text-xs text-accent-cyan font-mono bg-[#1a1a2e] px-2 py-0.5 rounded">{item.code}</code>
                </div>
                <p className="text-text-secondary text-sm mt-1">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key Concepts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-text-primary mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-accent-cyan" />
            Queue-First Design
          </h3>
          <p className="text-text-secondary text-sm">
            All generation endpoints use <code className="text-accent-violet">queue=true</code> by default. The API returns
            instantly with a <code className="text-accent-violet">request_id</code>. A background worker processes requests
            asynchronously. This prevents server timeouts and enables automatic retries.
          </p>
        </div>
        <div className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-text-primary mb-3 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-accent-emerald" />
            Real-Time Progress
          </h3>
          <p className="text-text-secondary text-sm">
            Every request tracks <code className="text-accent-violet">progress_pct</code> (0-100) and{" "}
            <code className="text-accent-violet">progress_stage</code> (Authenticating, Generating, Uploading, Complete).
            Poll <code className="text-accent-violet">GET /api/requests/{"{id}"}</code> every 2-3 seconds.
          </p>
        </div>
        <div className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-text-primary mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5 text-accent-amber" />
            Permanent Storage
          </h3>
          <p className="text-text-secondary text-sm">
            All generated media are auto-uploaded to Cloudflare R2. URLs are permanent (no expiration).
            Google Flow signed URLs expire in ~2 hours. R2 URLs look like{" "}
            <code className="text-accent-violet">pub-...r2.dev/requests/{"{id}"}.jpg</code>
          </p>
        </div>
        <div className="glass rounded-2xl p-6">
          <h3 className="text-lg font-bold text-text-primary mb-3 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-accent-pink" />
            Auto-Recovery
          </h3>
          <p className="text-text-secondary text-sm">
            Worker automatically recovers expired media (re-uploads to get fresh media_id), retries
            transient errors (extension disconnects), and retries reCAPTCHA failures up to 10 times.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Architecture Tab ─────────────────────────────────────── */

function ArchitectureTab() {
  return (
    <div className="space-y-6">
      {/* System Overview */}
      <div className="glass rounded-2xl p-6 glow-violet">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-accent-violet" />
          System Architecture
        </h2>
        <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-accent-cyan font-mono overflow-x-auto border border-[#2a2a4a] leading-relaxed">
{`┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐     │
│  │  Next.js UI  │  │  API Client  │  │  Third-Party Apps    │     │
│  │  (React)     │  │  (curl/SDK)  │  │  (Custom)            │     │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘     │
│         │                 │                      │                 │
│         └─────────────────┼──────────────────────┘                 │
│                           │ HTTP / WebSocket                       │
└───────────────────────────┼───────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│                    AGENT SERVER (port 8100)                        │
│                           │                                       │
│  ┌────────────────────────┼────────────────────────────────────┐  │
│  │                   FastAPI Router                             │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │  │
│  │  │ health  │ │projects │ │ flow    │ │requests │  ...      │  │
│  │  │ router  │ │ router  │ │ router  │ │ router  │          │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘          │  │
│  └───────┼───────────┼───────────┼───────────┼────────────────┘  │
│          │           │           │           │                     │
│  ┌───────┴───────────┴───────────┴───────────┴────────────────┐  │
│  │                    SERVICE LAYER                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│  │  │ Accounts │  │  CDP     │  │ Flow     │  │  Redis   │   │  │
│  │  │ Service  │  │ Client   │  │ Client   │  │  Queue   │   │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │  │
│  └───────┼─────────────┼─────────────┼─────────────┼──────────┘  │
│          │             │             │             │               │
│  ┌───────┴─────────────┴─────────────┴─────────────┴──────────┐  │
│  │                    WORKER LAYER                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  WorkerController (processor.py)                     │  │  │
│  │  │  - Polls SQLite for PENDING requests                 │  │  │
│  │  │  - Dequeues Redis overflow queue                     │  │  │
│  │  │  - Rate limits: 5 concurrent, 10s cooldown          │  │  │
│  │  │  - Dispatches to OperationService                    │  │  │
│  │  │  - Updates progress_pct + progress_stage             │  │  │
│  │  │  - Uploads results to R2                             │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    STORAGE LAYER                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ SQLite   │  │  Redis   │  │   R2     │  │  Event   │  │  │
│  │  │ (data)   │  │ (queue)  │  │ (media)  │  │  Bus     │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│                    EXTERNAL SERVICES                              │
│  ┌────────────────────────┼──────────────────────────────────┐   │
│  │  Chrome for Testing (port 9223)                           │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │  Chrome Extension (opdipieponnoalohmkmiajeeanaffnbe)│   │   │
│  │  │  - Captures flowKey from request headers           │   │   │
│  │  │  - Injects cookies via CDP                         │   │   │
│  │  │  - Makes API calls to Google Flow                  │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Google Flow (labs.google/fx/tools/flow)                   │   │
│  │  - Image generation (NARWHAL, GEM_PIX_2)                  │   │
│  │  - Video generation (Veo 3.1)                             │   │
│  │  - Upscaling (4K)                                         │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘`}
        </pre>
      </div>

      {/* Request Flow */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-accent-cyan" />
          Image Generation Flow
        </h2>
        <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-accent-emerald font-mono overflow-x-auto border border-[#2a2a4a] leading-relaxed">
{`Client                    Agent Server                Worker                  Chrome/Google Flow
  │                           │                         │                         │
  │  POST /generate-image     │                         │                         │
  │  {prompt, queue:true}     │                         │                         │
  │──────────────────────────>│                         │                         │
  │                           │                         │                         │
  │  ┌─ Create DB request ──┐ │                         │                         │
  │  │  status=PENDING      │ │                         │                         │
  │  └──────────────────────┘ │                         │                         │
  │                           │                         │                         │
  │  ┌─ Enqueue to Redis ───┐ │                         │                         │
  │  │  model=NARWHAL       │ │                         │                         │
  │  └──────────────────────┘ │                         │                         │
  │                           │                         │                         │
  │  {queued:true, request_id}│                         │                         │
  │<──────────────────────────│                         │                         │
  │                           │                         │                         │
  │  (client starts polling)  │         Poll loop        │                         │
  │                           │────────────────────────>│                         │
  │                           │                         │                         │
  │  ┌───────────────────────│  ┌─ Find free account ──┐│                         │
  │  │                       │  │  Acquire account     ││                         │
  │  │                       │  └─────────────────────┘│                         │
  │                           │                         │                         │
  │  GET /requests/{id}       │   progress_pct=10       │                         │
  │  {progress_pct:10,        │   progress_stage="Auth" │                         │
  │   progress_stage:"Auth"}  │                         │                         │
  │<──────────────────────────│                         │                         │
  │                           │                         │                         │
  │                           │   ensure_fresh_session()│                         │
  │                           │   - Inject cookies ────>│────────────────────────>│
  │                           │   - Navigate to Flow    │                         │
  │                           │   - Capture flowKey     │<────────────────────────│
  │                           │                         │                         │
  │  GET /requests/{id}       │   progress_pct=25       │                         │
  │  {progress_pct:25,        │   progress_stage="Gen"  │                         │
  │   progress_stage:"Gen"}   │                         │                         │
  │<──────────────────────────│                         │                         │
  │                           │                         │                         │
  │                           │                         │  generate_images()      │
  │                           │                         │────────────────────────>│
  │                           │                         │                         │
  │  GET /requests/{id}       │   progress_pct=50       │   (Google processing)   │
  │  {progress_pct:50}        │                         │                         │
  │<──────────────────────────│                         │                         │
  │                           │                         │                         │
  │                           │                         │  {output_url, media_id} │
  │                           │                         │<────────────────────────│
  │                           │                         │                         │
  │                           │   progress_pct=80       │                         │
  │                           │   "Uploading to R2"     │                         │
  │                           │                         │                         │
  │                           │   ┌─ Upload to R2 ─────┐│                         │
  │                           │   │  storage.upload()   ││                         │
  │                           │   └────────────────────┘│                         │
  │                           │                         │                         │
  │  GET /requests/{id}       │   progress_pct=100      │                         │
  │  {status:"COMPLETED",     │   status=COMPLETED      │                         │
  │   output_url:"...r2.dev"} │                         │                         │
  │<──────────────────────────│                         │                         │
  │                           │                         │                         │
  │  (display result)         │                         │                         │`}
        </pre>
      </div>

      {/* Data Flow */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-accent-amber" />
          Data Flow: Edit Image (URL)
        </h2>
        <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-accent-pink font-mono overflow-x-auto border border-[#2a2a4a] leading-relaxed">
{`┌─────────────┐    ┌──────────────┐    ┌──────────┐    ┌───────────┐    ┌──────────────┐
│  UI Client  │    │  Agent API   │    │  SQLite  │    │  Worker   │    │ Google Flow  │
└──────┬──────┘    └──────┬───────┘    └────┬─────┘    └─────┬─────┘    └──────┬───────┘
       │                  │                 │                 │                  │
       │ POST             │                 │                 │                  │
       │ /upload-image-   │                 │                 │                  │
       │ base64           │                 │                 │                  │
       │─────────────────>│                 │                 │                  │
       │                  │ upload to R2    │                 │                  │
       │  {source_url}    │────────────────>│                 │                  │
       │<─────────────────│                 │                 │                  │
       │                  │                 │                 │                  │
       │ POST             │                 │                 │                  │
       │ /edit-image-url  │                 │                 │                  │
       │ {source_url,     │                 │                 │                  │
       │  prompt}         │                 │                 │                  │
       │─────────────────>│                 │                 │                  │
       │                  │ INSERT request  │                 │                  │
       │                  │ type=EDIT_IMAGE │                 │                  │
       │                  │ status=PENDING  │                 │                  │
       │                  │────────────────>│                 │                  │
       │                  │                 │                 │                  │
       │  {queued:true,   │ ENQUEUE to Redis│                 │                  │
       │   request_id}    │────────────────>│                 │                  │
       │<─────────────────│                 │                 │                  │
       │                  │                 │                 │                  │
       │                  │            DEQUEUE               │                  │
       │                  │                 │<────────────────│                  │
       │                  │                 │                 │                  │
       │                  │                 │   download from │                  │
       │                  │                 │   source_url    │                  │
       │                  │                 │────────────────>│  upload image    │
       │                  │                 │                 │─────────────────>│
       │                  │                 │                 │  {media_id}      │
       │                  │                 │                 │<─────────────────│
       │                  │                 │                 │                  │
       │                  │                 │   edit_image()  │                  │
       │                  │                 │────────────────>│─────────────────>│
       │                  │                 │                 │  {output_url}    │
       │                  │                 │                 │<─────────────────│
       │                  │                 │                 │                  │
       │                  │                 │   upload to R2  │                  │
       │                  │                 │   (auto)        │                  │
       │                  │                 │                 │                  │
       │  Poll: COMPLETED │                 │                 │                  │
       │  output_url=R2   │                 │                 │                  │
       │<─────────────────│                 │                 │                  │`}
        </pre>
      </div>
    </div>
  );
}

/* ─── Progress Tab ─────────────────────────────────────────── */

function ProgressTab() {
  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 glow-emerald">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-accent-emerald" />
          Progress Tracking
        </h2>
        <p className="text-text-secondary mb-4">
          Every request tracks real-time progress. Poll <code className="text-accent-violet">GET /api/requests/{"{id}"}</code> every 2-3 seconds to get updates.
        </p>

        {/* Progress Fields */}
        <div className="glass rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Response Fields</h3>
          <div className="space-y-2">
            {[
              { field: "status", type: "string", values: "PENDING | PROCESSING | COMPLETED | FAILED", desc: "Current request state" },
              { field: "progress_pct", type: "int", values: "0 - 100", desc: "Completion percentage" },
              { field: "progress_stage", type: "string", values: "See stages below", desc: "Human-readable current stage" },
              { field: "output_url", type: "string|null", values: "R2 URL or null", desc: "Permanent media URL (set on completion)" },
              { field: "media_id", type: "string|null", values: "UUID or null", desc: "Google Flow media ID (set on completion)" },
              { field: "error_message", type: "string|null", values: "Error text or null", desc: "Error details (set on failure)" },
            ].map((f) => (
              <div key={f.field} className="flex items-center gap-3 p-3 rounded-lg bg-[#0f0f1a]">
                <code className="text-accent-violet font-mono text-xs w-32 flex-shrink-0">{f.field}</code>
                <code className="text-accent-cyan font-mono text-xs w-24 flex-shrink-0">{f.type}</code>
                <span className="text-text-secondary text-xs flex-1">{f.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Progress Stages */}
        <div className="glass rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Progress Stages</h3>
          <div className="space-y-3">
            {[
              { pct: "0%", stage: "PENDING", color: "bg-text-muted", desc: "Request created, waiting for worker" },
              { pct: "10%", stage: "Authenticating", color: "bg-accent-amber", desc: "Worker injecting cookies into Chrome" },
              { pct: "20%", stage: "Auth done", color: "bg-accent-amber", desc: "Cookies injected, flowKey captured" },
              { pct: "25%", stage: "Generating", color: "bg-accent-violet", desc: "Worker dispatching to Google Flow API" },
              { pct: "30%", stage: "Downloading source image", color: "bg-accent-cyan", desc: "EDIT_IMAGE: downloading from R2 URL" },
              { pct: "50%", stage: "Uploading to Google Flow", color: "bg-accent-cyan", desc: "EDIT_IMAGE: uploading source to Google" },
              { pct: "60%", stage: "Editing image", color: "bg-accent-violet", desc: "EDIT_IMAGE: calling edit API" },
              { pct: "80%", stage: "Uploading to storage", color: "bg-accent-emerald", desc: "Uploading result to Cloudflare R2" },
              { pct: "100%", stage: "Complete", color: "bg-accent-emerald", desc: "Done! output_url available" },
            ].map((s) => (
              <div key={s.pct} className="flex items-center gap-4 p-3 rounded-lg bg-[#0f0f1a]">
                <div className={`w-10 h-10 rounded-full ${s.color}/20 flex items-center justify-center`}>
                  <span className={`text-xs font-bold ${s.color.replace('bg-', 'text-')}`}>{s.pct}</span>
                </div>
                <div className="flex-1">
                  <code className="text-accent-violet font-mono text-sm">{s.stage}</code>
                  <p className="text-text-muted text-xs mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Example Polling Code */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Example: Polling in JavaScript</h3>
          <pre className="bg-[#0a0a0f] rounded-lg p-4 text-xs text-accent-cyan font-mono overflow-x-auto border border-[#2a2a4a]">
{`async function pollRequest(requestId) {
  const poll = setInterval(async () => {
    const res = await fetch(\`\${API_BASE}/api/requests/\${requestId}\`);
    const data = await res.json();

    // Update progress bar
    console.log(\`\${data.progress_pct}% - \${data.progress_stage}\`);

    if (data.status === "COMPLETED") {
      clearInterval(poll);
      console.log("Done!", data.output_url);  // Permanent R2 URL
    } else if (data.status === "FAILED") {
      clearInterval(poll);
      console.error("Failed:", data.error_message);
    }
  }, 3000);  // Poll every 3 seconds
}`}
          </pre>
        </div>
      </div>

      {/* Timing Estimates */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-accent-cyan" />
          Typical Timing
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { operation: "Image Generation", time: "15-45s", stages: "Auth (5s) → Generate (10-30s) → R2 (2s)" },
            { operation: "Image Edit (URL)", time: "20-60s", stages: "Download (3s) → Upload (5s) → Edit (10-30s) → R2 (2s)" },
            { operation: "Video Generation", time: "2-5 min", stages: "Auth (5s) → Generate (2-5 min) → R2 (5s)" },
          ].map((t) => (
            <div key={t.operation} className="glass rounded-xl p-4">
              <h3 className="text-text-primary font-semibold mb-1">{t.operation}</h3>
              <div className="text-2xl font-bold text-accent-violet mb-2">{t.time}</div>
              <p className="text-text-muted text-xs">{t.stages}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Queue Tab ────────────────────────────────────────────── */

function QueueTab() {
  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 glow-cyan">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-accent-cyan" />
          Queue System
        </h2>
        <p className="text-text-secondary mb-4">
          Flow Kit uses a dual-layer queue: SQLite for primary persistence, Redis for overflow and fast dequeue.
        </p>

        {/* Queue Architecture */}
        <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-accent-cyan font-mono overflow-x-auto border border-[#2a2a4a] mb-4 leading-relaxed">
{`┌──────────────────────────────────────────────────────────────┐
│                     QUEUE ARCHITECTURE                       │
│                                                              │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐  │
│  │  API Request │────>│   SQLite     │────>│   Worker     │  │
│  │  (POST)      │     │  (primary)   │     │  (poll loop) │  │
│  └─────────────┘     │              │     └──────┬───────┘  │
│                      │  PENDING ────│            │           │
│                      │  PROCESSING  │     ┌──────┴───────┐  │
│                      │  COMPLETED   │     │  Rate Limiter│  │
│                      │  FAILED      │     │  5 concurrent │  │
│                      └──────────────┘     │  10s cooldown │  │
│                             │             └──────┬───────┘  │
│                             │                    │           │
│                      ┌──────┴──────┐     ┌──────┴───────┐  │
│                      │   Redis     │     │   Chrome     │  │
│                      │  (overflow) │     │   Extension  │  │
│                      │             │     │   Bridge     │  │
│                      │  model:     │     └──────┬───────┘  │
│                      │  NARWHAL    │            │           │
│                      │  queue      │     ┌──────┴───────┐  │
│                      └─────────────┘     │ Google Flow  │  │
│                                          │   API        │  │
│                                          └──────────────┘  │
└──────────────────────────────────────────────────────────────┘`}
        </pre>

        {/* Queue Flow */}
        <div className="glass rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">How Requests Flow Through the Queue</h3>
          <div className="space-y-3">
            {[
              { step: "1", title: "API receives request", desc: "Creates DB record (status=PENDING), enqueues to Redis with model name" },
              { step: "2", title: "Worker polls SQLite", desc: "Fetches PENDING requests ordered by priority (characters > images > videos > upscale)" },
              { step: "3", title: "Worker checks Redis", desc: "If slots available, dequeues overflow requests from Redis" },
              { step: "4", title: "Account selection", desc: "Finds free account for the model. If busy, re-enqueues to Redis" },
              { step: "5", title: "Rate limiting", desc: "Max 5 concurrent requests, 10s cooldown between API calls" },
              { step: "6", title: "Processing", desc: "Injects cookies, captures flowKey, calls Google Flow API" },
              { step: "7", title: "Completion", desc: "Updates DB (status=COMPLETED, output_url), uploads to R2" },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3 p-3 rounded-lg bg-[#0f0f1a]">
                <span className="w-6 h-6 rounded-full bg-accent-cyan/20 text-accent-cyan flex items-center justify-center text-xs font-bold flex-shrink-0">{s.step}</span>
                <div>
                  <span className="text-text-primary font-medium text-sm">{s.title}</span>
                  <p className="text-text-muted text-xs mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Queue Timing */}
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Queue Wait Times</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { scenario: "No queue (1 request)", wait: "< 1s", desc: "Worker picks up immediately" },
              { scenario: "Light load (5 requests)", wait: "5-15s", desc: "Worker processes one at a time with 10s cooldown" },
              { scenario: "Heavy load (20 requests)", wait: "1-3 min", desc: "5 concurrent, ~30s per request" },
              { scenario: "All accounts busy", wait: "Until freed", desc: "Request stays in Redis until account available" },
            ].map((t) => (
              <div key={t.scenario} className="p-3 rounded-lg bg-[#0f0f1a]">
                <div className="flex items-center justify-between">
                  <span className="text-text-primary font-medium text-sm">{t.scenario}</span>
                  <span className="text-accent-violet font-mono text-sm">{t.wait}</span>
                </div>
                <p className="text-text-muted text-xs mt-1">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Routers Tab ──────────────────────────────────────────── */

function RoutersTab() {
  const routers = [
    { path: "/health", file: "main.py", desc: "Health check, extension status, WebSocket server", color: "text-accent-cyan" },
    { path: "/api/projects", file: "projects.py", desc: "CRUD for projects, character linking", color: "text-accent-violet" },
    { path: "/api/characters", file: "characters.py", desc: "CRUD for characters and entities", color: "text-accent-pink" },
    { path: "/api/videos", file: "videos.py", desc: "Video management, narration", color: "text-accent-amber" },
    { path: "/api/scenes", file: "scenes.py", desc: "Scene management, chain types", color: "text-accent-amber" },
    { path: "/api/requests", file: "requests.py", desc: "Request queue, batch operations, status polling", color: "text-accent-cyan" },
    { path: "/api/accounts", file: "accounts.py", desc: "Account management, cookie injection", color: "text-accent-violet" },
    { path: "/api/defaults", file: "defaults.py", desc: "Default model configuration", color: "text-accent-emerald" },
    { path: "/api/flow", file: "flow.py", desc: "Core generation endpoints (image, video, edit, upload)", color: "text-accent-emerald" },
    { path: "/api/tts", file: "tts.py", desc: "Text-to-speech, voice templates", color: "text-accent-pink" },
    { path: "/api/music", file: "music.py", desc: "Music generation via Suno AI", color: "text-accent-amber" },
    { path: "/ws/dashboard", file: "main.py", desc: "WebSocket for real-time dashboard events", color: "text-accent-cyan" },
  ];

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 glow-violet">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-accent-violet" />
          Router Map
        </h2>
        <p className="text-text-secondary mb-4">
          All routes are defined in <code className="text-accent-violet">agent/api/</code> and mounted in <code className="text-accent-violet">agent/main.py</code>.
        </p>

        <div className="space-y-2">
          {routers.map((r) => (
            <div key={r.path} className="flex items-center gap-4 p-3 rounded-lg bg-[#0f0f1a] border border-[#2a2a4a] hover:border-accent-violet/30 transition-all">
              <code className={`font-mono text-sm font-semibold w-40 ${r.color}`}>{r.path}</code>
              <code className="text-text-muted text-xs font-mono w-24">{r.file}</code>
              <span className="text-text-secondary text-sm flex-1">{r.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Route mounting diagram */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-accent-cyan" />
          Route Mounting (main.py)
        </h2>
        <pre className="bg-[#0a0a0f] rounded-xl p-4 text-xs text-accent-cyan font-mono overflow-x-auto border border-[#2a2a4a] leading-relaxed">
{`app = FastAPI(title="Flow Kit Agent")

# Core routers
app.include_router(projects.router,   prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(videos.router,     prefix="/api")
app.include_router(scenes.router,     prefix="/api")
app.include_router(requests.router,   prefix="/api")
app.include_router(accounts.router,   prefix="/api")
app.include_router(defaults.router,   prefix="/api")

# Flow engine
app.include_router(flow.router,       prefix="/api")

# Media
app.include_router(tts.router,        prefix="/api")
app.include_router(music.router,      prefix="/api")

# WebSocket
@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket): ...`}
        </pre>
      </div>
    </div>
  );
}

/* ─── Endpoints Tab ────────────────────────────────────────── */

function EndpointsTab({ searchQuery, setSearchQuery, filteredSections, activeSection, setActiveSection }: any) {
  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="mb-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search endpoints..."
          className="w-full px-5 py-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 focus:ring-1 focus:ring-accent-violet/20 transition-all"
        />
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {filteredSections.map((section: any) => (
          <div key={section.id} id={section.id}>
            <button
              onClick={() => setActiveSection(activeSection === section.id ? "" : section.id)}
              className="w-full flex items-center gap-3 mb-3 group"
            >
              <section.icon className={`w-5 h-5 ${section.color}`} />
              <h2 className="text-xl font-bold text-text-primary group-hover:text-accent-violet transition-colors">{section.title}</h2>
              <span className="text-xs text-text-muted bg-[#1a1a2e] px-2 py-0.5 rounded-full">{section.endpoints.length}</span>
              <ArrowRight className={`w-4 h-4 text-text-muted transition-transform ml-auto ${activeSection === section.id ? "rotate-90" : ""}`} />
            </button>
            {activeSection === section.id && (
              <div className="space-y-2 ml-8">
                {section.endpoints.map((ep: any, i: number) => (
                  <EndpointCard key={`${ep.method}-${ep.path}-${i}`} ep={ep} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Errors Tab ───────────────────────────────────────────── */

function ErrorsTab() {
  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 glow-red">
        <h2 className="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent-red" />
          Error Handling
        </h2>

        <div className="glass rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">HTTP Status Codes</h3>
          <div className="space-y-2">
            {[
              { code: "200", meaning: "Success", color: "text-accent-emerald" },
              { code: "400", meaning: "Bad Request — invalid parameters", color: "text-accent-amber" },
              { code: "404", meaning: "Not Found — resource doesn't exist", color: "text-accent-amber" },
              { code: "409", meaning: "Conflict — duplicate active request for scene", color: "text-accent-amber" },
              { code: "429", meaning: "Too Many Requests — all accounts busy", color: "text-accent-red" },
              { code: "500", meaning: "Internal Server Error", color: "text-accent-red" },
              { code: "502", meaning: "Bad Gateway — Google Flow API error", color: "text-accent-red" },
              { code: "503", meaning: "Service Unavailable — extension not connected", color: "text-accent-red" },
            ].map((e) => (
              <div key={e.code} className="flex items-center gap-4 p-3 rounded-lg bg-[#0f0f1a]">
                <span className={`font-mono font-bold ${e.color} w-10`}>{e.code}</span>
                <span className="text-text-secondary text-sm">{e.meaning}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Common Error Messages</h3>
          <div className="space-y-2">
            {[
              { error: "Extension not connected", fix: "Use queue=true to auto-launch Chrome. Worker will process when extension connects.", icon: "🔌" },
              { error: "All accounts busy", fix: "Use queue=true to auto-queue. Or add more accounts with POST /api/accounts.", icon: "👥" },
              { error: "Failed to capture auth token", fix: "Chrome may need cookies. Try again — worker will retry automatically.", icon: "🔑" },
              { error: "PUBLIC_ERROR_UNSAFE_GENERATION", fix: "Google rejected the prompt as unsafe. Rewrite the prompt.", icon: "🛡️" },
              { error: "entity not found", fix: "Media ID expired. Worker auto-recovers by re-uploading the image.", icon: "♻️" },
              { error: "No request ID in response", fix: "Server timed out. Ensure queue=true is set. Worker handles processing.", icon: "⏰" },
            ].map((e) => (
              <div key={e.error} className="p-3 rounded-lg bg-[#0f0f1a]">
                <div className="flex items-center gap-2 mb-1">
                  <span>{e.icon}</span>
                  <code className="text-accent-red font-mono text-sm">{e.error}</code>
                </div>
                <p className="text-text-secondary text-xs ml-7">{e.fix}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Auto-Retry Rules</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3 p-2 rounded-lg bg-[#0f0f1a]">
              <RefreshCw className="w-4 h-4 text-accent-emerald" />
              <span className="text-text-secondary">Extension disconnect/reconnect — retry immediately (no count increment)</span>
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-[#0f0f1a]">
              <RefreshCw className="w-4 h-4 text-accent-amber" />
              <span className="text-text-secondary">reCAPTCHA failure — retry up to 10 times with exponential backoff</span>
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-[#0f0f1a]">
              <RefreshCw className="w-4 h-4 text-accent-cyan" />
              <span className="text-text-secondary">Entity not found — auto-recover by re-uploading expired media</span>
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-[#0f0f1a]">
              <RefreshCw className="w-4 h-4 text-accent-violet" />
              <span className="text-text-secondary">General error — retry up to 5 times with exponential backoff (10s → 300s)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
