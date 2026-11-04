import { InputError } from "./errors.ts";

export const PUBLIC_FEATURES = [
  "text.translate",
  "image.remove_chinese_text",
  "image.replace_chinese_text",
  "image.background",
] as const;

export type PublicFeature = (typeof PUBLIC_FEATURES)[number];

export const IMAGE_TYPES = ["remove_chinese_text", "replace_chinese_text", "white_background"] as const;

export type ImageJobType = (typeof IMAGE_TYPES)[number];

export const SCENES = [
  "e-commerce-title",
  "e-commerce-description",
  "e-commerce-chat",
  "e-commerce-cpv",
  "novel",
  "game",
] as const;

export type Scene = (typeof SCENES)[number];

export const FORMAT_TYPES = ["text", "html"] as const;

export type FormatType = (typeof FORMAT_TYPES)[number];

export const FEATURE_FOR_IMAGE: Record<ImageJobType, PublicFeature> = {
  remove_chinese_text: "image.remove_chinese_text",
  replace_chinese_text: "image.replace_chinese_text",
  white_background: "image.background",
};

export const TEXT_LIMIT = 50_000;
export const TEXT_MAX_ITEMS = 50;
export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type PriceView = {
  feature: PublicFeature;
  credits: number | null;
  enabled: boolean;
  missing: boolean;
};

export type TranslateBody = {
  texts: string[];
  source_language: string;
  target_language: string;
  format_type: FormatType;
  scene: Scene;
};

export type ImageJobBody = {
  type: ImageJobType;
  image_url: string;
  target_language?: string;
};

export type AiTranslation = {
  translated_text: string;
  detected_language?: string | null;
  characters?: number | null;
};

export type AiJob = {
  id: string;
  workspace_id?: string;
  shop?: string;
  type?: string;
  status: string;
  input?: unknown;
  output?: {
    url?: string;
    character_count?: number;
    translations?: AiTranslation[];
  } | null;
  credits_reserved?: number;
  credits_used?: number;
  billing_state?: string | null;
  error?: {
    code?: string;
    message?: string | null;
    retryable?: boolean;
  } | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
};

export type TranslateResponse = {
  request_id?: string;
  job_id?: string;
  credits_used?: number;
  credits_balance?: number;
  character_count?: number;
  translations?: AiTranslation[];
};

export type JobResponse = {
  request_id?: string;
  job: AiJob;
  credits_balance?: number;
};

const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;

export function utf16Length(value: string): number {
  return value.length;
}

export function isPublicFeature(value: string): value is PublicFeature {
  return (PUBLIC_FEATURES as readonly string[]).includes(value);
}

export function isImageType(value: string): value is ImageJobType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

export function isScene(value: string): value is Scene {
  return (SCENES as readonly string[]).includes(value);
}

export function isFormatType(value: string): value is FormatType {
  return (FORMAT_TYPES as readonly string[]).includes(value);
}

function assertLanguage(value: unknown, field: string, allowAuto: boolean): string {
  if (typeof value !== "string") throw new InputError(`${field} is required.`);
  const language = value.trim();
  if (!language || language.length > 35 || /\s/.test(language)) throw new InputError(`${field} is invalid.`);
  if (language === "auto") {
    if (!allowAuto) throw new InputError("Choose a target language.");
    return language;
  }
  if (!LANGUAGE.test(language)) throw new InputError(`${field} must be a language code such as en or zh.`);
  return language;
}

export function normalizeTexts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > TEXT_MAX_ITEMS) {
    throw new InputError("Provide 1 to 50 texts.");
  }
  const texts = value.map((item) => {
    if (typeof item !== "string") throw new InputError("Each text must be a string.");
    const trimmed = item.trim();
    if (!trimmed) throw new InputError("Texts must not be empty.");
    return trimmed;
  });
  const total = texts.reduce((sum, text) => sum + utf16Length(text), 0);
  if (total > TEXT_LIMIT) throw new InputError("Texts exceed 50,000 UTF-16 units.");
  return texts;
}

export function buildTranslateBody(input: {
  texts: unknown;
  source_language: unknown;
  target_language: unknown;
  format_type: unknown;
  scene: unknown;
}): TranslateBody {
  const format = typeof input.format_type === "string" ? input.format_type : "";
  const scene = typeof input.scene === "string" ? input.scene : "";
  if (!isFormatType(format)) throw new InputError("format_type must be text or html.");
  if (!isScene(scene)) throw new InputError("scene is not a supported translation scene.");
  return {
    texts: normalizeTexts(input.texts),
    source_language: assertLanguage(input.source_language, "source_language", true),
    target_language: assertLanguage(input.target_language, "target_language", false),
    format_type: format,
    scene,
  };
}

export function assertHttpsImageUrl(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 2000) {
    throw new InputError("Enter an HTTPS image URL.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InputError("Enter a valid image URL.");
  }
  if (url.protocol !== "https:") throw new InputError("Image URL must use HTTPS.");
  if (url.username || url.password) throw new InputError("Image URL must not include credentials.");
  if (!url.hostname.includes(".")) throw new InputError("Image URL host is invalid.");
  return url.toString();
}

export function buildImageJobBody(input: {
  type: unknown;
  image_url: unknown;
  target_language?: unknown;
}): ImageJobBody {
  if (typeof input.type !== "string" || !isImageType(input.type)) {
    throw new InputError("Image type must be remove_chinese_text, replace_chinese_text, or white_background.");
  }
  const body: ImageJobBody = {
    type: input.type,
    image_url: assertHttpsImageUrl(input.image_url),
  };
  if (input.type === "replace_chinese_text") {
    body.target_language = assertLanguage(input.target_language, "target_language", false);
  }
  return body;
}

export function buildEstimateBody(input: {
  feature: unknown;
  texts?: unknown;
  source_language?: unknown;
  target_language?: unknown;
  format_type?: unknown;
  scene?: unknown;
}): Record<string, unknown> {
  if (typeof input.feature !== "string" || !isPublicFeature(input.feature)) {
    throw new InputError("Feature is not one of the four public V1 capabilities.");
  }
  if (input.feature === "text.translate") {
    const translate = buildTranslateBody({
      texts: input.texts,
      source_language: input.source_language,
      target_language: input.target_language,
      format_type: input.format_type,
      scene: input.scene,
    });
    return { feature: input.feature, ...translate };
  }
  return { feature: input.feature, count: 1 };
}

export function selectPublicPrices(rules: unknown): PriceView[] {
  const list = Array.isArray(rules) ? rules : [];
  return PUBLIC_FEATURES.map((feature) => {
    const rule = list.find((item) => {
      if (!item || typeof item !== "object") return false;
      return (item as { feature?: unknown }).feature === feature;
    }) as { credits?: unknown; enabled?: unknown } | undefined;
    if (!rule || typeof rule.credits !== "number" || typeof rule.enabled !== "boolean") {
      return { feature, credits: null, enabled: false, missing: true };
    }
    return { feature, credits: rule.credits, enabled: rule.enabled, missing: false };
  });
}

export function isTerminalJobStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "refunded";
}

export function assertJobId(jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId) || jobId.includes("..")) throw new InputError("Invalid job id.");
  return jobId;
}

export function jobPath(jobId: string): string {
  return `/v1/ai/jobs/${assertJobId(jobId)}`;
}

export function assetPath(jobId: string): string {
  return `/v1/ai/assets/${assertJobId(jobId)}.webp`;
}

const FIXED_PATHS = new Set([
  "/v1/ai/account",
  "/v1/ai/credits",
  "/v1/ai/credits/pricing",
  "/v1/ai/credits/estimate",
  "/v1/ai/text/translate",
  "/v1/ai/image/jobs",
]);

export function assertAllowedUpstreamPath(path: string): string {
  if (FIXED_PATHS.has(path)) return path;
  if (path.startsWith("/v1/ai/jobs/")) {
    assertJobId(path.slice("/v1/ai/jobs/".length));
    return path;
  }
  if (path.startsWith("/v1/ai/assets/") && path.endsWith(".webp")) {
    assertJobId(path.slice("/v1/ai/assets/".length, -".webp".length));
    return path;
  }
  throw new InputError("This demo does not proxy that request.");
}

export function existingJobId(error: { details?: Record<string, unknown> } | undefined): string | null {
  const jobId = error?.details?.job_id;
  return typeof jobId === "string" && JOB_ID_PATTERN.test(jobId) && !jobId.includes("..") ? jobId : null;
}

export function recoveryJobId(error: { code?: string; details?: Record<string, unknown> } | undefined): string | null {
  if (error?.code !== "AI_REQUEST_IN_PROGRESS" && error?.code !== "AI_RECONCILIATION_REQUIRED") return null;
  return existingJobId(error);
}

export type FailureAction = "retry" | "poll" | "stop";

export function actionForFailure(result: {
  ok: boolean;
  status: number;
  networkError?: boolean;
  error?: { code?: string; details?: Record<string, unknown> };
}): FailureAction {
  if (result.ok) return "stop";
  if (result.networkError || result.error?.code === "DEMO_UPSTREAM_NETWORK") return "retry";
  if (result.status === 429) return "retry";
  if (result.status === 503 && result.error?.details?.accepted === false) return "retry";
  if (result.status === 503 && existingJobId(result.error)) return "poll";
  if (recoveryJobId(result.error)) return "poll";
  return "stop";
}

export function statusHeadline(status: number, code?: string): string {
  if (code === "AI_REQUEST_IN_PROGRESS" || code === "AI_RECONCILIATION_REQUIRED") return "Checking the existing task";
  if (code === "DEMO_NOT_CONFIGURED") return "Add your API key and AI account";
  if (code === "DEMO_ACCOUNT_MISMATCH") return "The AI account does not match this API key";
  switch (status) {
    case 400:
      return "The request or image URL was rejected";
    case 401:
      return "The API key was rejected";
    case 402:
      return "Not enough AI credits";
    case 403:
      return "AI access or this feature is not enabled";
    case 409:
      return "This intent conflicts with an existing request";
    case 413:
      return "The image or request is too large";
    case 429:
      return "The app is rate limited";
    case 503:
      return "The AI service is temporarily unavailable";
    default:
      return "The request did not complete";
  }
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("HIOBUY_API_BASE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("HIOBUY_API_BASE_URL must use https.");
  if (url.username || url.password) throw new Error("HIOBUY_API_BASE_URL must not include credentials.");
  return url.origin;
}
