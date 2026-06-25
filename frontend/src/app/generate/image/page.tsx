"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ImagePlus,
  Loader2,
  CheckCircle,
  XCircle,
  Sparkles,
  Download,
  RotateCcw,
  Clock,
  Zap,
  ImageIcon,
  Square,
  RectangleHorizontal,
  Pencil,
  Upload,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { API_BASE } from "@/lib/api";

type GenerationState = "IDLE" | "SUBMITTING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
type GenMode = "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE";

interface GenerationResult {
  request_id: string;
  status: string;
  output_url?: string;
  media_id?: string;
  error?: string;
  position?: number;
}

const ASPECT_RATIOS = [
  { value: "IMAGE_ASPECT_RATIO_PORTRAIT", label: "Portrait", ratio: "3:4", icon: RectangleHorizontal },
  { value: "IMAGE_ASPECT_RATIO_LANDSCAPE", label: "Landscape", ratio: "4:3", icon: RectangleHorizontal },
  { value: "IMAGE_ASPECT_RATIO_SQUARE", label: "Square", ratio: "1:1", icon: Square },
];

const STATUS_MESSAGES: Record<string, string> = {
  IDLE: "Ready to Create",
  SUBMITTING: "Submitting request...",
  QUEUED: "Waiting in queue...",
  PROCESSING: "Generating your image...",
  COMPLETED: "Image ready!",
  FAILED: "Generation failed",
};

export default function ImageGenPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<GenMode>("TEXT_TO_IMAGE");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("IMAGE_ASPECT_RATIO_PORTRAIT");
  const [state, setState] = useState<GenerationState>("IDLE");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  // Image-to-image state
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourcePreview, setSourcePreview] = useState("");
  const [uploadingSource, setUploadingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestIdRef = useRef<string | null>(null);
  const stateRef = useRef<GenerationState>("IDLE");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    if (timerRef.current) clearInterval(timerRef.current);
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
          if (data.status === "COMPLETED") {
            setState("COMPLETED");
            setProgress(100);
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
            setResult({ request_id: requestId, status: data.status, output_url: data.output_url, media_id: data.media_id });
            toast("success", "Image generated successfully!");
          } else if (data.status === "FAILED") {
            setState("FAILED");
            setError(data.error_message || "Generation failed");
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
            toast("error", data.error_message || "Generation failed");
          } else if (data.status === "PROCESSING") {
            setProgress((prev) => Math.max(prev, 60));
          }
        }
      } catch (e) {}
    }, 2000);
  }, []);

  const handleUploadSourceFile = async (file: File) => {
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

      // Store the R2 URL (works even when extension is offline)
      const url = data.source_url || data.media_id;
      setSourceUrl(url);
      setSourcePreview(URL.createObjectURL(file));
    } catch (e: any) {
      setError(e.message);
    }
    setUploadingSource(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (mode === "IMAGE_TO_IMAGE" && !sourceUrl) {
      setError("Please upload a source image first");
      return;
    }

    setState("SUBMITTING");
    setError("");
    setResult(null);
    setProgress(10);

    try {
      let url: string;
      let body: any;

      if (mode === "TEXT_TO_IMAGE") {
        url = `${API_BASE}/api/flow/generate-image`;
        body = { prompt: prompt.trim(), project_id: "default", aspect_ratio: aspectRatio, queue: true };
      } else {
        url = `${API_BASE}/api/flow/edit-image-url`;
        body = { prompt: prompt.trim(), source_url: sourceUrl, project_id: "default", aspect_ratio: aspectRatio, queue: true };
      }

      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to submit");

      const reqId = data.request_id || data._requestId;
      if (reqId) {
        requestIdRef.current = reqId;
        setState(data.queued ? "QUEUED" : "PROCESSING");
        setProgress(data.queued ? 20 : 40);
        startElapsedTimer();
        startPolling(reqId);
      } else if (data._mediaId || data.data?._mediaId) {
        setState("COMPLETED");
        setProgress(100);
        const mid = data._mediaId || data.data?._mediaId;
        setResult({ request_id: "direct", status: "COMPLETED", media_id: mid });
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
    requestIdRef.current = null;
    stopTimers();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgressSteps = () => {
    if (state === "IDLE" || state === "SUBMITTING") return [];
    return [
      { label: "Queued", done: progress >= 20, active: state === "QUEUED" },
      { label: "Auth", done: progress >= 40, active: state === "PROCESSING" && progress < 60 },
      { label: "Generating", done: progress >= 80, active: state === "PROCESSING" && progress >= 60 },
      { label: "Complete", done: progress >= 100, active: false },
    ];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold gradient-text flex items-center gap-3">
            <ImagePlus className="w-10 h-10" />
            Image Generation
          </h1>
          <p className="text-text-secondary mt-2 text-lg">
            Create stunning AI images with Google Flow
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setMode("TEXT_TO_IMAGE"); setSourceUrl(""); setSourcePreview(""); }}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
              mode === "TEXT_TO_IMAGE"
                ? "bg-accent-violet/20 text-accent-violet border border-accent-violet/30"
                : "bg-[#1a1a2e] text-text-secondary hover:text-text-primary border border-transparent"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Text to Image
          </button>
          <button
            onClick={() => setMode("IMAGE_TO_IMAGE")}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
              mode === "IMAGE_TO_IMAGE"
                ? "bg-accent-pink/20 text-accent-pink border border-accent-pink/30"
                : "bg-[#1a1a2e] text-text-secondary hover:text-text-primary border border-transparent"
            }`}
          >
            <Pencil className="w-4 h-4" />
            Image to Image
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel - Form */}
          <div className="space-y-6">
            {/* Source Image (Image-to-Image only) */}
            {mode === "IMAGE_TO_IMAGE" && (
              <div className="glass rounded-2xl p-6 glow-pink">
                <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">
                  Source Image
                </label>
                {sourcePreview ? (
                  <div className="relative rounded-xl overflow-hidden mb-3">
                    <img src={sourcePreview} alt="Source" className="w-full max-h-64 object-contain rounded-xl bg-[#0f0f1a]" />
                    <button
                      onClick={() => { setSourceUrl(""); setSourcePreview(""); }}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                    {sourceUrl && (
                      <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-accent-emerald/80 text-white text-xs">
                        Ready
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[#2a2a4a] rounded-xl p-8 text-center cursor-pointer hover:border-accent-pink/50 hover:bg-accent-pink/5 transition-all"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadSourceFile(file);
                      }}
                    />
                    {uploadingSource ? (
                      <Loader2 className="w-10 h-10 text-accent-pink mx-auto mb-3 animate-spin" />
                    ) : (
                      <FolderOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
                    )}
                    <p className="text-text-secondary font-medium">
                      {uploadingSource ? "Uploading..." : "Click to select an image"}
                    </p>
                    <p className="text-xs text-text-muted mt-1">PNG, JPG, WEBP up to 10MB</p>
                  </div>
                )}
              </div>
            )}

            {/* Prompt Input */}
            <div className={`glass rounded-2xl p-6 ${mode === "TEXT_TO_IMAGE" ? "glow-violet" : "glow-pink"}`}>
              <label className="block text-sm font-semibold text-text-primary mb-3 uppercase tracking-wider">
                {mode === "TEXT_TO_IMAGE" ? "Describe your image" : "Edit instructions"}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={mode === "TEXT_TO_IMAGE"
                  ? "A magical castle floating in the clouds at sunset..."
                  : "Change the sky to night, add stars, make it more dramatic..."}
                className="w-full h-40 px-5 py-4 rounded-xl bg-[#0f0f1a] border border-[#2a2a4a] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-violet/60 focus:ring-2 focus:ring-accent-violet/20 resize-none transition-all text-lg"
                disabled={state !== "IDLE"}
              />
              <div className="flex justify-between mt-2 text-sm text-text-muted">
                <span>{prompt.length} characters</span>
                <span>{mode === "TEXT_TO_IMAGE" ? "Be descriptive for best results" : "Describe what to change"}</span>
              </div>
            </div>

            {/* Aspect Ratio */}
            <div className="glass rounded-2xl p-6">
              <label className="block text-sm font-semibold text-text-primary mb-4 uppercase tracking-wider">Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-3">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.value}
                    onClick={() => setAspectRatio(ar.value)}
                    disabled={state !== "IDLE"}
                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                      aspectRatio === ar.value
                        ? "border-accent-violet bg-accent-violet/10 text-accent-violet"
                        : "border-[#2a2a4a] bg-[#0f0f1a] text-text-secondary hover:border-accent-violet/30"
                    } disabled:opacity-50`}
                  >
                    <ar.icon className="w-8 h-8" />
                    <span className="font-medium">{ar.label}</span>
                    <span className="text-xs text-text-muted">{ar.ratio}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={state !== "IDLE" || !prompt.trim() || (mode === "IMAGE_TO_IMAGE" && !sourceUrl)}
              className={`w-full py-4 rounded-xl text-white font-bold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 animate-gradient ${
                mode === "TEXT_TO_IMAGE"
                  ? "bg-gradient-to-r from-accent-violet via-accent-pink to-accent-cyan"
                  : "bg-gradient-to-r from-accent-pink via-accent-violet to-accent-cyan"
              }`}
            >
              {state === "IDLE" && (
                <>
                  {mode === "TEXT_TO_IMAGE" ? <Sparkles className="w-6 h-6" /> : <Pencil className="w-6 h-6" />}
                  {mode === "TEXT_TO_IMAGE" ? "Generate Image" : "Edit Image"}
                </>
              )}
              {state === "SUBMITTING" && <><Loader2 className="w-6 h-6 animate-spin" /> Submitting...</>}
              {(state === "QUEUED" || state === "PROCESSING") && <><Loader2 className="w-6 h-6 animate-spin" /> Processing...</>}
              {state === "COMPLETED" && <><CheckCircle className="w-6 h-6" /> Done!</>}
              {state === "FAILED" && <><XCircle className="w-6 h-6" /> Failed</>}
            </button>

            {state !== "IDLE" && (
              <button onClick={handleReset} className="w-full py-3 rounded-xl border border-[#2a2a4a] text-text-secondary hover:bg-[#1a1a2e] transition-all flex items-center justify-center gap-2">
                <RotateCcw className="w-5 h-5" />
                Start New Generation
              </button>
            )}
          </div>

          {/* Right Panel - Status & Preview */}
          <div className="space-y-6">
            {state !== "IDLE" && (
              <div className="glass rounded-2xl p-6 glow-violet">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">{STATUS_MESSAGES[state]}</h3>
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Clock className="w-4 h-4" />
                    <span className="font-mono">{formatTime(elapsedTime)}</span>
                  </div>
                </div>
                <div className="h-3 bg-[#0f0f1a] rounded-full overflow-hidden mb-4">
                  <div className="h-full bg-gradient-to-r from-accent-violet via-accent-pink to-accent-cyan transition-all duration-500 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between">
                  {getProgressSteps().map((step, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className={`w-3 h-3 rounded-full ${step.done ? "bg-accent-emerald" : step.active ? "bg-accent-violet pulse-glow" : "bg-[#2a2a4a]"}`} />
                      <span className={`text-xs ${step.done ? "text-accent-emerald" : step.active ? "text-accent-violet" : "text-text-muted"}`}>{step.label}</span>
                    </div>
                  ))}
                </div>
                {state === "QUEUED" && result?.position && (
                  <div className="mt-4 p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
                    <div className="flex items-center gap-2 text-accent-amber">
                      <Zap className="w-4 h-4" />
                      <span className="font-medium">Position #{result.position} in queue</span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">Estimated wait: ~{result.position * 15} seconds</p>
                  </div>
                )}
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
                  <RotateCcw className="w-4 h-4" />
                  Retry
                </button>
              </div>
            )}

            {state === "COMPLETED" && result?.output_url && (
              <div className="glass rounded-2xl p-6 border-accent-emerald/30 bg-accent-emerald/5">
                <div className="flex items-center gap-2 text-accent-emerald mb-4">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-semibold text-lg">Image Generated!</span>
                </div>
                <div className="relative rounded-xl overflow-hidden cursor-pointer group mb-4" onClick={() => setShowPreview(true)}>
                  <img src={result.output_url} alt="Generated image" className="w-full h-auto rounded-xl transition-transform group-hover:scale-[1.02]" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white font-medium bg-black/50 px-4 py-2 rounded-lg">Click to view full size</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <a href={result.output_url} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 rounded-xl bg-accent-emerald/20 text-accent-emerald hover:bg-accent-emerald/30 transition-all flex items-center justify-center gap-2 font-medium">
                    <Download className="w-5 h-5" /> Download
                  </a>
                  <button onClick={handleGenerate} className="flex-1 py-3 rounded-xl bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all flex items-center justify-center gap-2 font-medium">
                    <RotateCcw className="w-5 h-5" /> Generate Again
                  </button>
                </div>
                <div className="mt-4 p-3 rounded-lg bg-[#0f0f1a] text-sm">
                  <div className="flex justify-between text-text-secondary">
                    <span>Request ID</span>
                    <span className="font-mono text-text-muted">{result.request_id.slice(0, 12)}...</span>
                  </div>
                  {result.media_id && (
                    <div className="flex justify-between text-text-secondary mt-1">
                      <span>Media ID</span>
                      <span className="font-mono text-text-muted">{result.media_id.slice(0, 12)}...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {state === "IDLE" && (
              <div className="glass rounded-2xl p-8 text-center">
                <ImageIcon className="w-16 h-16 text-text-muted mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-text-primary mb-2">Ready to Create</h3>
                <p className="text-text-secondary">
                  {mode === "TEXT_TO_IMAGE"
                    ? "Enter a prompt and click Generate to create your image"
                    : "Upload a source image, describe your edits, and click Edit Image"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPreview && result?.output_url && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8" onClick={() => setShowPreview(false)}>
          <button className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors" onClick={() => setShowPreview(false)}>
            <XCircle className="w-8 h-8" />
          </button>
          <img src={result.output_url} alt="Generated image" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          <a href={result.output_url} target="_blank" rel="noopener noreferrer" className="absolute bottom-6 right-6 px-6 py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Download className="w-5 h-5" /> Download
          </a>
        </div>
      )}
    </div>
  );
}
