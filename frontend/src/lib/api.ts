export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8100";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `API error ${res.status}`);
  return data;
}

export async function getHealth() {
  return apiFetch("/health");
}

export async function getFlowStatus() {
  return apiFetch("/api/flow/status");
}

export async function getAccounts() {
  return apiFetch("/api/accounts");
}

export async function getDefaults() {
  return apiFetch("/api/defaults");
}

export async function updateDefault(type: string, model: string) {
  return apiFetch("/api/defaults", {
    method: "POST",
    body: JSON.stringify({ type, model }),
  });
}

export async function generateImage(body: {
  prompt: string;
  project_id?: string;
  aspect_ratio?: string;
  queue?: boolean;
}) {
  return apiFetch("/api/flow/generate-image", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function generateVideo(body: {
  start_image_media_id: string;
  prompt: string;
  project_id?: string;
  scene_id: string;
  aspect_ratio?: string;
}) {
  return apiFetch("/api/flow/generate-video", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function generateVideoRefs(body: {
  reference_media_ids: string[];
  prompt: string;
  project_id?: string;
  scene_id: string;
  aspect_ratio?: string;
}) {
  return apiFetch("/api/flow/generate-video-refs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function upscaleVideo(body: {
  media_id: string;
  scene_id: string;
  aspect_ratio?: string;
  resolution?: string;
}) {
  return apiFetch("/api/flow/upscale-video", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getMedia(mediaId: string) {
  return apiFetch(`/api/flow/media/${mediaId}`);
}

export async function getCredits() {
  return apiFetch("/api/flow/credits");
}

export async function listProjects() {
  return apiFetch("/api/projects");
}

export async function createProject(body: { title: string; material?: string }) {
  return apiFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listRequests(params?: { status?: string; type?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.type) qs.set("type", params.type);
  if (params?.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return apiFetch(`/api/requests${q ? `?${q}` : ""}`);
}

export async function uploadToR2(url: string, key?: string): Promise<{ url: string; key: string }> {
  return apiFetch("/api/flow/upload-to-r2", {
    method: "POST",
    body: JSON.stringify({ url, key }),
  });
}

export async function editImage(body: {
  prompt: string;
  source_media_id: string;
  project_id?: string;
  aspect_ratio?: string;
}) {
  return apiFetch("/api/flow/edit-image", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function uploadImageUrl(url: string, project_id?: string): Promise<{ media_id: string }> {
  return apiFetch("/api/flow/upload-image-url", {
    method: "POST",
    body: JSON.stringify({ url, project_id }),
  });
}

export async function uploadImageBase64(image_base64: string, mime_type?: string, project_id?: string): Promise<{ media_id: string | null; source_url?: string; source: string }> {
  return apiFetch("/api/flow/upload-image-base64", {
    method: "POST",
    body: JSON.stringify({ image_base64, mime_type, project_id }),
  });
}

export async function editImageUrl(body: {
  prompt: string;
  source_url: string;
  project_id?: string;
  aspect_ratio?: string;
  queue?: boolean;
}) {
  return apiFetch("/api/flow/edit-image-url", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Account-project management
export async function listProjectsByAccount(accountId: string) {
  return apiFetch(`/api/projects?account_id=${accountId}`);
}

export async function createProjectForAccount(body: { title: string; account_id: string; material?: string }) {
  return apiFetch(`/api/accounts/${body.account_id}/create-project`, {
    method: "POST",
    body: JSON.stringify({ title: body.title, material: body.material }),
  });
}

export async function deleteProject(projectId: string) {
  return apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
}

export async function getProjectUrl(projectId: string) {
  return apiFetch(`/api/projects/${projectId}/url`);
}

export async function updateAccount(accountId: string, body: { project_mode?: string; bound_project_id?: string | null }) {
  return apiFetch(`/api/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
