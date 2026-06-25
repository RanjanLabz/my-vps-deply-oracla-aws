"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video,
  Loader2,
  CheckCircle,
  XCircle,
  Sparkles,
  Wand2,
  ArrowUpCircle,
  Download,
  RotateCcw,
  Clock,
  Zap,
  Play,
  FolderOpen,
  Image,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { API_BASE } from "@/lib/api";

type Tab = "i2v" | "r2v" | "upscale";
type GenState = "IDLE" | "SUBMITTING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

const ASPECT_RATIOS = [
  { value: "VIDEO_ASPECT_RATIO_PORTRAIT", label: "Portrait", ratio: "9:16" },
  { value: "VIDEO_ASPECT_RATIO_LANDSCAPE", label: "Landscape", ratio: "16:9" },
];

export default function VideoGenPage() {
  const [tab, setTab] = useState<Tab>("i2v");

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold gradient-text flex items-center gap-3">
            <Video className="w-10 h-10" />
            Video Generation
          </h1>
          <p className="text-text-secondary mt-2 text-lg">
            Generate and upscale AI videos with Google Flow
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex gap-2 mb-8">
          {([
            { key: "i2v", label: "Image to Video", icon: Play, color: "cyan" },
            { key: "r2v", label: "Reference Video", icon: Wand2, color: "violet" },
            { key: "upscale", label: "Upscale 4K", icon: ArrowUpCircle, color: "amber" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
                tab === t.key
                  ? `bg-accent-${t.color}/20 text-accent-${t.color} border border-accent-${t.color}/30`
                  : "bg-[#1a1a2e] text-text-secondary hover:text-text-primary border border-transparent"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "i2v" && <I2VForm />}
        {tab === "r2v" && <R2VForm />}
        {tab === "upscale" && <UpscaleForm />}
      </div>
    </div>
  );
}

function I2VForm() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("VIDEO_ASPECT_RATIO_PORTRAIT");
  const [state, setState] = useState<GenState>("IDLE");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progressStage, setProgressStage] = useState("");

  // Source image state
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [uploadingSource, setUploadingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestIdRef = useRef<string | null>(null);
  const stateRef = useRef<GenState>("IDLE");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startElapsedTimer = useCallback(() => {
    elapsedRef.current = 0;
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedTime(elapsedRef.current);
    }, 1000);
  }, []);

  const startPolling = useCallback((requestId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (stateRef.current === "COMPLETED" || stateRef.current === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/requests/${requestId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progress_pct > 0) {
            setProgress(data.progress_pct);
            setProgressStage(data.progress_stage || "");
          }
          if (data.status === "COMPLETED") {
            setState("COMPLETED");
            setProgress(100);
            stopTimers();
            setResult({ request_id: requestId, ...data });
            toast("success", "Video generated successfully!");
          } else if (data.status === "FAILED") {
            setState("FAILED");
            setError(data.error_message || "Generation failed");
            stopTimers();
            toast("error", data.error_message || "Generation failed");
          }
        }
      } catch (e) {}
    }, 3000);
  }, [stopTimers]);

  const handleUploadSource = async (file: File) => {
    setUploadingSource(true);
    setError("");
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${API_BASE}/api/flow/upload-image-base64`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64, mime_type: file.type || "image/jpeg" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setSourceUrl(data.source_url);
      setSourcePreview(URL.createObjectURL(file));
    } catch (e: any) {
      setError(e.message);
    }
    setUploadingSource(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !sourceUrl) return;
    setState("SUBMITTING");
    setError("");
    setResult(null);
    setProgress(10);

    try {
      const res = await fetch(`${API_BASE}/api/flow/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_image_url: sourceUrl,
          prompt: prompt.trim(),
          project_id: "default",
          aspect_ratio: aspectRatio,
          queue: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");

      const reqId = data.request_id;
      if (reqId) {
        requestIdRef.current = reqId;
        setState(data.queued ? "QUEUED" : "PROCESSING");
        setProgress(data.queued ? 20 : 40);
        startElapsedTimer();
        startPolling(reqId);
      } else {
        setState("FAILED");
        setError("No request ID in response");
      }
    } catch (e: any) {
      setState("FAILED");
      setError(e.message);
      stopTimers();
    }
  };

  const handleReset = () => {
    setState("IDLE");
    setResult(null);
    setError("");
    setProgress(0);
    setElapsedTime(0);
    setProgressStage("");
    requestIdRef.current = null;
    stopTimers();
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Panel */}
      <div className="space-y-6">
        {/* Source Image */}
        <div className="glass rounded-2xl p-6 glow-cyan">
          <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Start Image</label>
          {sourcePreview ? (
            <div className="relative rounded-xl overflow-hidden mb-3">
              <img src={sourcePreview} alt="Source" className="w-full max-h-64 object-contain rounded-xl bg-[#0f0f1a]" />
              <button
                onClick={() => { setSourceUrl(""); setSourcePreview(""); }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {sourceUrl && (
                <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-accent-emerald/80 text-white text-xs">Ready</div>
              )}
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#2a2a4a] rounded-xl p-8 text-center cursor-pointer hover:border-accent-cyan/50 hover:bg-accent-cyan/5 transition-all"
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadSource(f); }} />
              {uploadingSource ? (
                <Loader2 className="w-10 h-10 text-accent-cyan mx-auto mb-3 animate-spin" />
              ) : (
                <FolderOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
              )}
              <p className="text-text-secondary font-medium">{uploadingSource ? "Uploading..." : "Click to select start frame"}</p>
              <p className="text-xs text-text-muted mt-1">PNG, JPG, WEBP</p>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="glass rounded-2xl p-6 glow-cyan">
          <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Video Motion</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe how the scene moves... 0-3s: camera pans right. 3-6s: character walks forward."
            className="w-full h-36 px-5 py-4 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/60 focus:ring-2 focus:ring-accent-cyan/20 resize-none transition-all"
            disabled={state !== "IDLE"}
          />
        </div>

        {/* Aspect Ratio */}
        <div className="glass rounded-2xl p-6">
          <label className="block text-sm font-semibold text-text-primary mb-4 uppercase tracking-wider">Aspect Ratio</label>
          <div className="grid grid-cols-2 gap-3">
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.value}
                onClick={() => setAspectRatio(ar.value)}
                disabled={state !== "IDLE"}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                  aspectRatio === ar.value
                    ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                    : "border-[#2a2a4a] bg-[#0f0f1a] text-text-secondary hover:border-accent-cyan/30"
                } disabled:opacity-50`}
              >
                <span className="font-medium">{ar.label}</span>
                <span className="text-xs text-text-muted">{ar.ratio}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={state !== "IDLE" || !prompt.trim() || !sourceUrl}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-accent-cyan via-accent-emerald to-accent-cyan text-white font-bold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 animate-gradient"
        >
          {state === "IDLE" && <><Play className="w-6 h-6" /> Generate Video</>}
          {state === "SUBMITTING" && <><Loader2 className="w-6 h-6 animate-spin" /> Submitting...</>}
          {(state === "QUEUED" || state === "PROCESSING") && <><Loader2 className="w-6 h-6 animate-spin" /> Processing...</>}
          {state === "COMPLETED" && <><CheckCircle className="w-6 h-6" /> Done!</>}
          {state === "FAILED" && <><XCircle className="w-6 h-6" /> Failed</>}
        </button>

        {state !== "IDLE" && (
          <button onClick={handleReset} className="w-full py-3 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5" /> Start New
          </button>
        )}
      </div>

      {/* Right Panel - Status & Preview */}
      <div className="space-y-6">
        {state !== "IDLE" && (
          <div className="glass rounded-2xl p-6 glow-cyan">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {state === "QUEUED" ? "Waiting in queue" : state === "PROCESSING" ? "Generating..." : state === "COMPLETED" ? "Video Ready!" : state === "FAILED" ? "Failed" : "Starting..."}
              </h3>
              <div className="flex items-center gap-2 text-text-secondary">
                <Clock className="w-4 h-4" />
                <span className="font-mono">{formatTime(elapsedTime)}</span>
              </div>
            </div>
            <div className="h-3 bg-[#0f0f1a] rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-accent-cyan to-accent-emerald transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
            </div>
            {progressStage && (
              <p className="text-sm text-text-secondary mb-3">{progressStage}</p>
            )}
            <div className="flex justify-between text-xs text-text-muted">
              <span>{Math.round(progress)}%</span>
              <span>Video generation takes 2-5 minutes</span>
            </div>
          </div>
        )}

        {state === "FAILED" && error && (
          <div className="glass rounded-2xl p-6 border-accent-red/30 bg-accent-red/5">
            <div className="flex items-center gap-2 text-accent-red mb-3">
              <XCircle className="w-6 h-6" />
              <span className="font-semibold text-lg">Generation Failed</span>
            </div>
            <p className="text-text-secondary">{error}</p>
            <button onClick={handleGenerate} className="mt-4 px-6 py-2 rounded-lg bg-accent-red/20 text-accent-red hover:bg-accent-red/30 transition-all flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        {state === "COMPLETED" && result?.output_url && (
          <div className="glass rounded-2xl p-6 border-accent-emerald/30 bg-accent-emerald/5">
            <div className="flex items-center gap-2 text-accent-emerald mb-4">
              <CheckCircle className="w-6 h-6" />
              <span className="font-semibold text-lg">Video Generated!</span>
            </div>
            <div className="rounded-xl overflow-hidden mb-4 bg-black">
              <video src={result.output_url} controls className="w-full max-h-80 object-contain" />
            </div>
            <div className="flex gap-3">
              <a href={result.output_url} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-3 rounded-xl bg-accent-emerald/20 text-accent-emerald hover:bg-accent-emerald/30 transition-all flex items-center justify-center gap-2 font-medium">
                <Download className="w-5 h-5" /> Download
              </a>
              <button onClick={handleReset}
                className="flex-1 py-3 rounded-xl bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 transition-all flex items-center justify-center gap-2 font-medium">
                <RotateCcw className="w-5 h-5" /> Generate Again
              </button>
            </div>
          </div>
        )}

        {state === "IDLE" && (
          <div className="glass rounded-2xl p-8 text-center">
            <Video className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">Ready to Create</h3>
            <p className="text-text-secondary">Upload a start frame, describe the motion, and click Generate</p>
          </div>
        )}
      </div>
    </div>
  );
}

function R2VForm() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("VIDEO_ASPECT_RATIO_PORTRAIT");
  const [state, setState] = useState<GenState>("IDLE");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progressStage, setProgressStage] = useState("");

  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestIdRef = useRef<string | null>(null);
  const stateRef = useRef<GenState>("IDLE");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); if (pollRef.current) clearInterval(pollRef.current); }, []);

  const stopTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startElapsedTimer = useCallback(() => {
    elapsedRef.current = 0; setElapsedTime(0);
    timerRef.current = setInterval(() => { elapsedRef.current += 1; setElapsedTime(elapsedRef.current); }, 1000);
  }, []);

  const startPolling = useCallback((requestId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (stateRef.current === "COMPLETED" || stateRef.current === "FAILED") { clearInterval(pollRef.current!); return; }
      try {
        const res = await fetch(`${API_BASE}/api/requests/${requestId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progress_pct > 0) { setProgress(data.progress_pct); setProgressStage(data.progress_stage || ""); }
          if (data.status === "COMPLETED") { setState("COMPLETED"); setProgress(100); stopTimers(); setResult({ request_id: requestId, ...data }); }
          else if (data.status === "FAILED") { setState("FAILED"); setError(data.error_message || "Failed"); stopTimers(); }
        }
      } catch (e) {}
    }, 3000);
  }, [stopTimers]);

  const handleUploadRefs = async (files: FileList) => {
    setUploadingRef(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch(`${API_BASE}/api/flow/upload-image-base64`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: base64, mime_type: file.type || "image/jpeg" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        setReferenceUrls((prev) => [...prev, data.source_url]);
        setReferencePreviews((prev) => [...prev, URL.createObjectURL(file)]);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setUploadingRef(false);
  };

  const removeRef = (index: number) => {
    setReferenceUrls((prev) => prev.filter((_, i) => i !== index));
    setReferencePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || referenceUrls.length === 0) return;
    setState("SUBMITTING"); setError(""); setResult(null); setProgress(10);
    try {
      const res = await fetch(`${API_BASE}/api/flow/generate-video-refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_media_ids: referenceUrls, prompt: prompt.trim(), project_id: "default", aspect_ratio: aspectRatio, queue: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      const reqId = data.request_id;
      if (reqId) {
        requestIdRef.current = reqId;
        setState(data.queued ? "QUEUED" : "PROCESSING");
        setProgress(data.queued ? 20 : 40);
        startElapsedTimer();
        startPolling(reqId);
      } else {
        setState("FAILED"); setError("No request ID in response");
      }
    } catch (e: any) { setState("FAILED"); setError(e.message); stopTimers(); }
  };

  const handleReset = () => {
    setState("IDLE"); setResult(null); setError(""); setProgress(0); setElapsedTime(0); setProgressStage("");
    requestIdRef.current = null; stopTimers();
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        {/* Reference Images */}
        <div className="glass rounded-2xl p-6 glow-violet">
          <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Reference Images</label>
          {referencePreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              {referencePreviews.map((src, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden">
                  <img src={src} alt={`Ref ${i + 1}`} className="w-full h-24 object-cover rounded-xl" />
                  <button onClick={() => removeRef(i)} className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white hover:bg-black/80">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[#2a2a4a] rounded-xl p-6 text-center cursor-pointer hover:border-accent-violet/50 hover:bg-accent-violet/5 transition-all"
          >
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files?.length) handleUploadRefs(e.target.files); }} />
            {uploadingRef ? (
              <Loader2 className="w-8 h-8 text-accent-violet mx-auto mb-2 animate-spin" />
            ) : (
              <Image className="w-8 h-8 text-text-muted mx-auto mb-2" />
            )}
            <p className="text-text-secondary font-medium text-sm">{uploadingRef ? "Uploading..." : "Click to add reference images"}</p>
          </div>
        </div>

        {/* Prompt */}
        <div className="glass rounded-2xl p-6 glow-violet">
          <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Video Prompt</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the video using the reference images..."
            className="w-full h-36 px-5 py-4 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/60 resize-none transition-all"
            disabled={state !== "IDLE"} />
        </div>

        {/* Aspect Ratio */}
        <div className="glass rounded-2xl p-6">
          <label className="block text-sm font-semibold text-text-primary mb-4 uppercase tracking-wider">Aspect Ratio</label>
          <div className="grid grid-cols-2 gap-3">
            {ASPECT_RATIOS.map((ar) => (
              <button key={ar.value} onClick={() => setAspectRatio(ar.value)} disabled={state !== "IDLE"}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${aspectRatio === ar.value ? "border-accent-violet bg-accent-violet/10 text-accent-violet" : "border-[#2a2a4a] bg-[#0f0f1a] text-text-secondary hover:border-accent-violet/30"} disabled:opacity-50`}>
                <span className="font-medium">{ar.label}</span>
                <span className="text-xs text-text-muted">{ar.ratio}</span>
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleGenerate} disabled={state !== "IDLE" || !prompt.trim() || referenceUrls.length === 0}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-accent-violet via-accent-pink to-accent-violet text-white font-bold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 animate-gradient">
          {state === "IDLE" && <><Wand2 className="w-6 h-6" /> Generate Reference Video</>}
          {state === "SUBMITTING" && <><Loader2 className="w-6 h-6 animate-spin" /> Submitting...</>}
          {(state === "QUEUED" || state === "PROCESSING") && <><Loader2 className="w-6 h-6 animate-spin" /> Processing...</>}
          {state === "COMPLETED" && <><CheckCircle className="w-6 h-6" /> Done!</>}
          {state === "FAILED" && <><XCircle className="w-6 h-6" /> Failed</>}
        </button>

        {state !== "IDLE" && (
          <button onClick={handleReset} className="w-full py-3 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5" /> Start New
          </button>
        )}
      </div>

      <div className="space-y-6">
        {state !== "IDLE" && (
          <div className="glass rounded-2xl p-6 glow-violet">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {state === "QUEUED" ? "Waiting in queue" : state === "PROCESSING" ? "Generating..." : state === "COMPLETED" ? "Video Ready!" : state === "FAILED" ? "Failed" : "Starting..."}
              </h3>
              <div className="flex items-center gap-2 text-text-secondary"><Clock className="w-4 h-4" /><span className="font-mono">{formatTime(elapsedTime)}</span></div>
            </div>
            <div className="h-3 bg-[#0f0f1a] rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-accent-violet to-accent-pink transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
            </div>
            {progressStage && <p className="text-sm text-text-secondary mb-3">{progressStage}</p>}
            <div className="flex justify-between text-xs text-text-muted"><span>{Math.round(progress)}%</span><span>Video generation takes 2-5 minutes</span></div>
          </div>
        )}

        {state === "FAILED" && error && (
          <div className="glass rounded-2xl p-6 border-accent-red/30 bg-accent-red/5">
            <div className="flex items-center gap-2 text-accent-red mb-3"><XCircle className="w-6 h-6" /><span className="font-semibold text-lg">Failed</span></div>
            <p className="text-text-secondary">{error}</p>
            <button onClick={handleGenerate} className="mt-4 px-6 py-2 rounded-lg bg-accent-red/20 text-accent-red hover:bg-accent-red/30 transition-all flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        {state === "COMPLETED" && result?.output_url && (
          <div className="glass rounded-2xl p-6 border-accent-emerald/30 bg-accent-emerald/5">
            <div className="flex items-center gap-2 text-accent-emerald mb-4"><CheckCircle className="w-6 h-6" /><span className="font-semibold text-lg">Video Generated!</span></div>
            <div className="rounded-xl overflow-hidden mb-4 bg-black">
              <video src={result.output_url} controls className="w-full max-h-80 object-contain" />
            </div>
            <div className="flex gap-3">
              <a href={result.output_url} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 rounded-xl bg-accent-emerald/20 text-accent-emerald hover:bg-accent-emerald/30 transition-all flex items-center justify-center gap-2 font-medium">
                <Download className="w-5 h-5" /> Download
              </a>
              <button onClick={handleReset} className="flex-1 py-3 rounded-xl bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all flex items-center justify-center gap-2 font-medium">
                <RotateCcw className="w-5 h-5" /> Again
              </button>
            </div>
          </div>
        )}

        {state === "IDLE" && (
          <div className="glass rounded-2xl p-8 text-center">
            <Wand2 className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">Reference Video</h3>
            <p className="text-text-secondary">Upload reference images and describe the video you want to create</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UpscaleForm() {
  const [mediaId, setMediaId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("VIDEO_ASPECT_RATIO_PORTRAIT");
  const [resolution, setResolution] = useState("VIDEO_RESOLUTION_4K");
  const [state, setState] = useState<GenState>("IDLE");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [progressStage, setProgressStage] = useState("");

  const requestIdRef = useRef<string | null>(null);
  const stateRef = useRef<GenState>("IDLE");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); if (pollRef.current) clearInterval(pollRef.current); }, []);

  const stopTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startElapsedTimer = useCallback(() => {
    elapsedRef.current = 0; setElapsedTime(0);
    timerRef.current = setInterval(() => { elapsedRef.current += 1; setElapsedTime(elapsedRef.current); }, 1000);
  }, []);

  const startPolling = useCallback((requestId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (stateRef.current === "COMPLETED" || stateRef.current === "FAILED") { clearInterval(pollRef.current!); return; }
      try {
        const res = await fetch(`${API_BASE}/api/requests/${requestId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progress_pct > 0) { setProgress(data.progress_pct); setProgressStage(data.progress_stage || ""); }
          if (data.status === "COMPLETED") { setState("COMPLETED"); setProgress(100); stopTimers(); setResult({ request_id: requestId, ...data }); }
          else if (data.status === "FAILED") { setState("FAILED"); setError(data.error_message || "Failed"); stopTimers(); }
        }
      } catch (e) {}
    }, 3000);
  }, [stopTimers]);

  const handleUpscale = async () => {
    if (!mediaId.trim()) return;
    setState("SUBMITTING"); setError(""); setResult(null); setProgress(10);
    try {
      const res = await fetch(`${API_BASE}/api/flow/upscale-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId.trim(), scene_id: sceneId.trim() || undefined, aspect_ratio: aspectRatio, resolution, queue: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      const reqId = data.request_id;
      if (reqId) {
        requestIdRef.current = reqId;
        setState(data.queued ? "QUEUED" : "PROCESSING");
        setProgress(data.queued ? 20 : 40);
        startElapsedTimer();
        startPolling(reqId);
      } else {
        setState("FAILED"); setError("No request ID in response");
      }
    } catch (e: any) { setState("FAILED"); setError(e.message); stopTimers(); }
  };

  const handleReset = () => {
    setState("IDLE"); setResult(null); setError(""); setProgress(0); setElapsedTime(0); setProgressStage("");
    requestIdRef.current = null; stopTimers();
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="glass rounded-2xl p-6 glow-amber">
        <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Video Media ID</label>
        <input value={mediaId} onChange={(e) => setMediaId(e.target.value)} placeholder="UUID of the video to upscale"
          className="w-full px-5 py-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-amber/60 transition-all"
          disabled={state !== "IDLE"} />
      </div>

      <div className="glass rounded-2xl p-6">
        <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">Scene ID (optional)</label>
        <input value={sceneId} onChange={(e) => setSceneId(e.target.value)} placeholder="Optional scene ID"
          className="w-full px-5 py-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-amber/60 transition-all"
          disabled={state !== "IDLE"} />
      </div>

      <div className="glass rounded-2xl p-6">
        <label className="block text-sm font-semibold text-text-primary mb-4 uppercase tracking-wider">Settings</label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-2">Aspect Ratio</label>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={state !== "IDLE"}
              className="w-full px-4 py-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary focus:outline-none focus:border-accent-amber/60 transition-all">
              <option value="VIDEO_ASPECT_RATIO_PORTRAIT">Portrait (9:16)</option>
              <option value="VIDEO_ASPECT_RATIO_LANDSCAPE">Landscape (16:9)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-2">Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={state !== "IDLE"}
              className="w-full px-4 py-3 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary focus:outline-none focus:border-accent-amber/60 transition-all">
              <option value="VIDEO_RESOLUTION_4K">4K</option>
              <option value="VIDEO_RESOLUTION_1080P">1080p</option>
            </select>
          </div>
        </div>
      </div>

      <button onClick={handleUpscale} disabled={state !== "IDLE" || !mediaId.trim()}
        className="w-full py-4 rounded-xl bg-gradient-to-r from-accent-amber via-accent-red to-accent-amber text-white font-bold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 animate-gradient">
        {state === "IDLE" && <><ArrowUpCircle className="w-6 h-6" /> Upscale to 4K</>}
        {state === "SUBMITTING" && <><Loader2 className="w-6 h-6 animate-spin" /> Submitting...</>}
        {(state === "QUEUED" || state === "PROCESSING") && <><Loader2 className="w-6 h-6 animate-spin" /> Processing...</>}
        {state === "COMPLETED" && <><CheckCircle className="w-6 h-6" /> Done!</>}
        {state === "FAILED" && <><XCircle className="w-6 h-6" /> Failed</>}
      </button>

      {state !== "IDLE" && (
          <button onClick={handleReset} className="w-full py-3 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5" /> Start New
          </button>
        )}

      {state !== "IDLE" && (
        <div className="glass rounded-2xl p-6 glow-amber">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary">
              {state === "QUEUED" ? "Waiting" : state === "PROCESSING" ? "Upscaling..." : state === "COMPLETED" ? "Done!" : state === "FAILED" ? "Failed" : "Starting..."}
            </h3>
            <div className="flex items-center gap-2 text-text-secondary"><Clock className="w-4 h-4" /><span className="font-mono">{formatTime(elapsedTime)}</span></div>
          </div>
          <div className="h-3 bg-[#0f0f1a] rounded-full overflow-hidden mb-3">
            <div className="h-full bg-gradient-to-r from-accent-amber to-accent-red transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          {progressStage && <p className="text-sm text-text-secondary mb-3">{progressStage}</p>}
          <div className="flex justify-between text-xs text-text-muted"><span>{Math.round(progress)}%</span><span>Upscaling takes 1-3 minutes</span></div>
        </div>
      )}

      {state === "FAILED" && error && (
        <div className="glass rounded-2xl p-6 border-accent-red/30 bg-accent-red/5">
          <div className="flex items-center gap-2 text-accent-red mb-3"><XCircle className="w-6 h-6" /><span className="font-semibold text-lg">Failed</span></div>
          <p className="text-text-secondary">{error}</p>
        </div>
      )}

      {state === "COMPLETED" && result?.output_url && (
        <div className="glass rounded-2xl p-6 border-accent-emerald/30 bg-accent-emerald/5">
          <div className="flex items-center gap-2 text-accent-emerald mb-4"><CheckCircle className="w-6 h-6" /><span className="font-semibold text-lg">Upscaled!</span></div>
          <div className="rounded-xl overflow-hidden mb-4 bg-black">
            <video src={result.output_url} controls className="w-full max-h-80 object-contain" />
          </div>
          <a href={result.output_url} target="_blank" rel="noopener noreferrer"
            className="w-full py-3 rounded-xl bg-accent-emerald/20 text-accent-emerald hover:bg-accent-emerald/30 transition-all flex items-center justify-center gap-2 font-medium">
            <Download className="w-5 h-5" /> Download 4K
          </a>
        </div>
      )}

      {state === "IDLE" && (
        <div className="glass rounded-2xl p-8 text-center">
          <ArrowUpCircle className="w-16 h-16 text-text-muted mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-text-primary mb-2">Upscale Video</h3>
          <p className="text-text-secondary">Enter a video media ID to upscale to 4K resolution</p>
        </div>
      )}
    </div>
  );
}
