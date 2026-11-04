import type { DemoResult, NormalizedError } from "../../shared/errors.ts";
import type { PriceView } from "../../shared/contract.ts";

export type Session = {
  ok: true;
  configured: boolean;
  account_ok: boolean;
  shop: string | null;
  balance: number | null;
  balance_request_id: string | null;
  prices: PriceView[];
  error: NormalizedError | null;
};

export type Estimate = {
  request_id?: string;
  feature?: string;
  count?: number;
  unit_credits?: number;
  credits_required?: number;
  credits_balance?: number;
  can_afford?: boolean;
  credits_shortfall?: number;
};

async function send<T>(path: string, init: RequestInit = {}): Promise<DemoResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      request_id: null,
      networkError: true,
      error: {
        code: "NETWORK_ERROR",
        message: "The browser could not reach the local demo server.",
        request_id: null,
      },
    };
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    return {
      ok: false,
      status: response.status,
      request_id: null,
      error: {
        code: "DEMO_BAD_RESPONSE",
        message: "The local demo server returned an unreadable response.",
        request_id: null,
      },
    };
  }
  return payload as DemoResult<T>;
}

export function getSession(signal?: AbortSignal): Promise<Session> {
  return fetch("/api/session", { signal, headers: { Accept: "application/json" } }).then(async (response) => {
    const payload = (await response.json()) as Session;
    return payload;
  });
}

export function getCredits(signal?: AbortSignal) {
  return send<{ credits_balance?: number; request_id?: string }>("/api/credits", { signal });
}

export function estimate(body: unknown, signal?: AbortSignal) {
  return send<Estimate>("/api/estimate", { method: "POST", body: JSON.stringify(body), signal });
}

export function translate(body: unknown, idempotencyKey: string, signal?: AbortSignal) {
  return send<unknown>("/api/translate", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
    headers: { "X-Idempotency-Key": idempotencyKey },
  });
}

export function createImageJob(body: unknown, idempotencyKey: string, signal?: AbortSignal) {
  return send<unknown>("/api/image-jobs", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
    headers: { "X-Idempotency-Key": idempotencyKey },
  });
}

export function getJob(jobId: string, signal?: AbortSignal) {
  return send<unknown>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal });
}
