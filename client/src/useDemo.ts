import { useEffect, useMemo, useRef, useState } from "react";
import {
  actionForFailure,
  assertHttpsImageUrl,
  buildEstimateBody,
  buildImageJobBody,
  buildTranslateBody,
  existingJobId,
  isTerminalJobStatus,
  statusHeadline,
  utf16Length,
  type AiJob,
  type ImageJobBody,
  type JobResponse,
  type PriceView,
  type TranslateBody,
  type TranslateResponse,
} from "../../shared/contract.ts";
import { InputError, type NormalizedError } from "../../shared/errors.ts";
import { buildCurl } from "../../shared/curl.ts";
import { pollJob } from "../../shared/poll.ts";
import { delay, isAbortError, postWithRetry } from "../../shared/retry.ts";
import { scrubSecrets } from "../../shared/scrub.ts";
import {
  createImageJob,
  estimate,
  getCredits,
  getJob,
  getSession,
  translate,
  type Estimate,
  type Session,
} from "./api.ts";
import { exampleResponse } from "./examples.ts";
import { featureById, type FeatureId } from "./features.ts";

type RunState =
  | { phase: "idle" | "submitting" | "polling" | "done" }
  | { phase: "error" | "timeout"; headline: string; message: string; requestId: string | null; code?: string };

type TextOutput = {
  kind: "text";
  original: string;
  translated: string;
  detected: string | null;
  creditsUsed: number | null;
  requestId: string | null;
  characterCount: number | null;
};

type ImageOutput = {
  kind: "image";
  originalUrl: string;
  job: AiJob;
  requestId: string | null;
};

export type DemoOutput = TextOutput | ImageOutput;

type Exchange = {
  feature: FeatureId;
  signature: string;
  curl: string;
  response: unknown | null;
  label: string;
};

const SAMPLE_KEY = "unique-processing-intent-001";

export function useDemo() {
  const [feature, setFeatureState] = useState<FeatureId>("translate");
  const [text, setText] = useState("轻薄透气纯棉夏季衬衫");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [scene, setScene] = useState<TranslateBody["scene"]>("e-commerce-title");
  const [formatType, setFormatType] = useState<TranslateBody["format_type"]>("text");
  const [imageUrl, setImageUrl] = useState("");
  const [imageLanguage, setImageLanguage] = useState("en");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [estimateResult, setEstimateResult] = useState<Estimate | null>(null);
  const [estimateError, setEstimateError] = useState<NormalizedError | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [output, setOutput] = useState<DemoOutput | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runToken = useRef(0);

  const selected = featureById(feature);
  function setFeature(next: FeatureId) {
    setFeatureState(next);
    setEstimateResult(null);
    setEstimateError(null);
  }
  const signature = useMemo(
    () => JSON.stringify({ feature, text, sourceLanguage, targetLanguage, scene, formatType, imageUrl, imageLanguage }),
    [feature, text, sourceLanguage, targetLanguage, scene, formatType, imageUrl, imageLanguage],
  );

  useEffect(() => {
    const controller = new AbortController();
    setSessionLoading(true);
    getSession(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setSession(next);
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        setSession(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    setOutput(null);
    setRun({ phase: "idle" });
    setExchange(null);
    setActiveJobId(null);
    setEstimateResult(null);
    setEstimateError(null);
    return () => abortRef.current?.abort();
  }, [feature]);

  const price: PriceView | undefined = session?.prices.find((item) => item.feature === selected.feature);
  const inputError = validateInput(feature, text, imageUrl);
  const running = run.phase === "submitting" || run.phase === "polling";
  const disabledByPrice = Boolean(price && !price.missing && !price.enabled);
  const canRun = Boolean(session?.account_ok) && !running && !inputError && !disabledByPrice;

  useEffect(() => {
    if (!session?.account_ok || disabledByPrice) {
      setEstimateResult(null);
      setEstimateError(null);
      setEstimating(false);
      return;
    }
    const body = estimateBody();
    if (!body) {
      setEstimateResult(null);
      setEstimateError(null);
      setEstimating(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setEstimating(true);
      estimate(body, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.ok) {
            setEstimateResult(result.data);
            setEstimateError(null);
          } else {
            setEstimateResult(null);
            setEstimateError(result.error);
          }
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) setEstimateError({ code: "NETWORK_ERROR", message: "Estimate failed.", request_id: null });
        })
        .finally(() => {
          if (!controller.signal.aborted) setEstimating(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    function estimateBody() {
      try {
        if (feature === "translate") {
          if (!text.trim()) return null;
          return buildEstimateBody({
            feature: "text.translate",
            texts: [text],
            source_language: sourceLanguage,
            target_language: targetLanguage,
            format_type: formatType,
            scene,
          });
        }
        return buildEstimateBody({ feature: selected.feature });
      } catch {
        return null;
      }
    }
  }, [disabledByPrice, feature, formatType, scene, selected.feature, session?.account_ok, sourceLanguage, targetLanguage, text]);

  function alive(token: number, controller: AbortController) {
    return token === runToken.current && !controller.signal.aborted;
  }

  async function refreshBalance() {
    const result = await getCredits();
    if (!result.ok || typeof result.data.credits_balance !== "number") return;
    setSession((current) => current ? {
      ...current,
      balance: result.data.credits_balance ?? null,
      balance_request_id: result.request_id,
    } : current);
  }

  async function followJob(jobId: string, originalUrl: string, controller: AbortController, token: number, kind: "text" | "image") {
    if (!alive(token, controller)) return;
    setRun({ phase: "polling" });
    setActiveJobId(jobId);
    const outcome = await pollJob({
      jobId,
      signal: controller.signal,
      jitter: () => Math.floor(Math.random() * 250),
      sleep: (ms) => delay(ms, controller.signal),
      fetchJob: async (id) => {
        const result = await getJob(id, controller.signal);
        if (!result.ok) {
          return {
            ok: false as const,
            status: result.status,
            retryAfterMs: result.retry_after_ms,
            error: result.error,
          };
        }
        const data = result.data as JobResponse;
        if (alive(token, controller)) {
          rememberResponse(data, "Actual job response");
          if (kind === "image") setOutput({ kind: "image", originalUrl, job: data.job, requestId: result.request_id });
        }
        return { ok: true as const, job: data.job, requestId: result.request_id };
      },
    });
    if (!alive(token, controller)) return;
    if (outcome.kind === "timeout") {
      setRun({
        phase: "timeout",
        headline: "Polling stopped",
        message: `Job ${jobId} may still be running. Refresh status checks the same job. Run again starts a new billed intent.`,
        requestId: null,
      });
      return;
    }
    if (outcome.kind === "error") {
      setRun({
        phase: "error",
        headline: statusHeadline(outcome.status, outcome.error.code),
        message: outcome.error.message,
        requestId: outcome.error.request_id,
        code: outcome.error.code,
      });
      return;
    }
    applyJob(outcome.job, outcome.requestId, originalUrl, kind);
    await refreshBalance();
  }

  function applyJob(job: AiJob, requestId: string | null, originalUrl: string, kind: "text" | "image") {
    const translations = job.output?.translations;
    if (kind === "text") {
      if (translations && translations.length > 0) {
        setOutput({
          kind: "text",
          original: text,
          translated: translations.map((item) => item.translated_text).join("\n\n"),
          detected: translations[0]?.detected_language ?? null,
          creditsUsed: typeof job.credits_used === "number" ? job.credits_used : null,
          requestId,
          characterCount: job.output?.character_count ?? null,
        });
      }
    } else {
      setOutput({ kind: "image", originalUrl, job, requestId });
    }
    if (job.status === "failed" || job.status === "refunded") {
      setRun({
        phase: "error",
        headline: job.error?.code || "The task failed",
        message: job.error?.message || "The task did not complete.",
        requestId,
        code: job.error?.code,
      });
      return;
    }
    setRun({ phase: "done" });
  }

  function rememberResponse(response: unknown, label: string) {
    setExchange((current) => current ? { ...current, response: scrubSecrets(response, []), label } : current);
  }

  async function execute() {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const token = ++runToken.current;
    const key = crypto.randomUUID();
    setRun({ phase: "submitting" });
    setOutput(null);
    try {
      if (feature === "translate") {
        const body = buildTranslateBody({
          texts: [text],
          source_language: sourceLanguage,
          target_language: targetLanguage,
          format_type: formatType,
          scene,
        });
        setExchange({ feature, signature, curl: textCurl(body, key), response: null, label: "Waiting for response" });
        const result = await postWithRetry({
          signal: controller.signal,
          sleep: (ms) => delay(ms, controller.signal),
          send: () => translate(body, key, controller.signal),
        });
        if (!alive(token, controller)) return;
        if (!result.ok) {
          const jobId = actionForFailure(result) === "poll" ? existingJobId(result.error) : null;
          rememberResponse(result, "Actual error response");
          if (jobId) {
            await followJob(jobId, "", controller, token, "text");
            return;
          }
          showFailure(result.status, result.error);
          return;
        }
        const data = result.data as TranslateResponse;
        rememberResponse(data, "Actual response");
        if (data.translations?.length) {
          setOutput({
            kind: "text",
            original: text,
            translated: data.translations.map((item) => item.translated_text).join("\n\n"),
            detected: data.translations[0]?.detected_language ?? null,
            creditsUsed: typeof data.credits_used === "number" ? data.credits_used : null,
            requestId: result.request_id,
            characterCount: typeof data.character_count === "number" ? data.character_count : null,
          });
          setRun({ phase: "done" });
          await refreshBalance();
          return;
        }
        if (data.job_id) {
          await followJob(data.job_id, "", controller, token, "text");
          return;
        }
        setRun({ phase: "error", headline: "The translation response had no text", message: "The API did not return translations or a job id.", requestId: result.request_id });
        return;
      }

      const body = buildImageJobBody({
        type: selected.imageType,
        image_url: imageUrl,
        target_language: imageLanguage,
      });
      setExchange({ feature, signature, curl: imageCurl(body, key, null), response: null, label: "Waiting for response" });
      const result = await postWithRetry({
        signal: controller.signal,
        sleep: (ms) => delay(ms, controller.signal),
        send: () => createImageJob(body, key, controller.signal),
      });
      if (!alive(token, controller)) return;
      if (!result.ok) {
        const jobId = actionForFailure(result) === "poll" ? existingJobId(result.error) : null;
        rememberResponse(result, "Actual error response");
        if (jobId) {
          await followJob(jobId, imageUrl, controller, token, "image");
          return;
        }
        showFailure(result.status, result.error);
        return;
      }
      const data = result.data as JobResponse;
      rememberResponse(data, "Actual response");
      setExchange((current) => current ? { ...current, curl: imageCurl(body, key, data.job?.id ?? null) } : current);
      if (!data.job?.id) {
        setRun({ phase: "error", headline: "The image response had no job", message: "The API did not return a job id.", requestId: result.request_id });
        return;
      }
      setActiveJobId(data.job.id);
      if (isTerminalJobStatus(data.job.status)) {
        applyJob(data.job, result.request_id, imageUrl, "image");
        await refreshBalance();
        return;
      }
      await followJob(data.job.id, imageUrl, controller, token, "image");
    } catch (error) {
      if (isAbortError(error) || !alive(token, controller)) return;
      const message = error instanceof InputError ? error.message : "The request could not be sent.";
      setRun({ phase: "error", headline: "The request was not sent", message, requestId: null, code: error instanceof InputError ? error.code : undefined });
    }
  }

  async function refreshStatus() {
    if (!activeJobId || running) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const token = ++runToken.current;
    try {
      await followJob(activeJobId, imageUrl, controller, token, feature === "translate" ? "text" : "image");
    } catch (error) {
      if (!isAbortError(error)) {
        setRun({ phase: "error", headline: "Status refresh failed", message: "The job could not be loaded.", requestId: null });
      }
    }
  }

  function showFailure(status: number, error: NormalizedError) {
    setRun({
      phase: "error",
      headline: statusHeadline(status, error.code),
      message: error.message,
      requestId: error.request_id,
      code: error.code,
    });
  }

  const preview = useMemo(() => buildPreview({
    feature,
    text,
    sourceLanguage,
    targetLanguage,
    scene,
    formatType,
    imageUrl,
    imageLanguage,
    imageType: selected.imageType,
  }), [feature, formatType, imageLanguage, imageUrl, scene, selected.imageType, sourceLanguage, targetLanguage, text]);

  const showActual = exchange?.feature === feature && exchange.signature === signature;
  const curl = showActual ? exchange.curl : preview.curl;
  const responseLabel = showActual && exchange.response ? exchange.label : "Illustrative response shape";
  const responseBody = showActual && exchange.response ? exchange.response : exampleResponse(feature, selected.imageType);

  return {
    feature,
    setFeature,
    selected,
    text,
    setText,
    sourceLanguage,
    setSourceLanguage,
    targetLanguage,
    setTargetLanguage,
    scene,
    setScene,
    formatType,
    setFormatType,
    imageUrl,
    setImageUrl,
    imageLanguage,
    setImageLanguage,
    session,
    sessionLoading,
    estimateResult,
    estimateError,
    estimating,
    run,
    output,
    price,
    inputError,
    canRun,
    running,
    activeJobId,
    execute,
    refreshStatus,
    curl,
    requestLabel: showActual ? "Exact request sent for this form" : preview.label,
    responseLabel,
    responseBody,
    textUnits: utf16Length(text.trim()),
  };
}

function validateInput(feature: FeatureId, text: string, imageUrl: string): string | null {
  if (feature === "translate") {
    if (!text.trim()) return "Enter text to translate.";
    if (utf16Length(text.trim()) > 50_000) return "Text exceeds 50,000 UTF-16 units.";
    return null;
  }
  if (!imageUrl.trim()) return "Enter an HTTPS image URL.";
  try {
    assertHttpsImageUrl(imageUrl);
    return null;
  } catch (error) {
    return error instanceof InputError ? error.message : "Enter an HTTPS image URL.";
  }
}

function textCurl(body: TranslateBody, idempotencyKey: string): string {
  return `${buildCurl({
    method: "POST",
    path: "/v1/ai/text/translate",
    idempotencyKey,
    body,
  })}\n\n# A completed translation returns translations[].translated_text.\n# AI_REQUEST_IN_PROGRESS and AI_RECONCILIATION_REQUIRED mean: poll the existing job instead of creating another one.`;
}

function imageCurl(body: ImageJobBody, idempotencyKey: string, jobId: string | null): string {
  const create = buildCurl({
    method: "POST",
    path: "/v1/ai/image/jobs",
    idempotencyKey,
    body,
  });
  const poll = buildCurl({
    method: "GET",
    path: `/v1/ai/jobs/${jobId ?? "YOUR_JOB_ID"}`,
  });
  return `${create}\n\n# Poll until job.status is completed, failed, or refunded. HTTP 200 or 202 is not completion.\n${poll}`;
}

function buildPreview(input: {
  feature: FeatureId;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  scene: TranslateBody["scene"];
  formatType: TranslateBody["format_type"];
  imageUrl: string;
  imageLanguage: string;
  imageType?: ImageJobBody["type"];
}): { curl: string; label: string } {
  try {
    if (input.feature === "translate") {
      const body = buildTranslateBody({
        texts: [input.text],
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
        format_type: input.formatType,
        scene: input.scene,
      });
      return { curl: textCurl(body, SAMPLE_KEY), label: "Request for the current form" };
    }
    const body = buildImageJobBody({
      type: input.imageType,
      image_url: input.imageUrl,
      target_language: input.imageLanguage,
    });
    return { curl: imageCurl(body, SAMPLE_KEY, null), label: "Request for the current form" };
  } catch {
    if (input.feature === "translate") {
      return {
        curl: textCurl({
          texts: ["轻薄透气纯棉夏季衬衫"],
          source_language: "auto",
          target_language: "en",
          format_type: "text",
          scene: "e-commerce-title",
        }, SAMPLE_KEY),
        label: "Example request",
      };
    }
    return {
      curl: imageCurl({
        type: input.imageType ?? "remove_chinese_text",
        image_url: "https://cdn.example.com/product.jpg",
        ...(input.imageType === "replace_chinese_text" ? { target_language: "en" } : {}),
      }, SAMPLE_KEY, null),
      label: "Example request",
    };
  }
}
