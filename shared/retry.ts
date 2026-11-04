import { actionForFailure, type FailureAction } from "./contract.ts";
import type { DemoResult } from "./errors.ts";

export function nextPollDelayMs(attempt: number): number {
  return Math.min(5000, Math.round(1000 * 1.5 ** attempt));
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const MAX_EXTRA_ATTEMPTS = 2;

export async function postWithRetry<T>(options: {
  send: () => Promise<DemoResult<T>>;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<DemoResult<T>> {
  let extras = 0;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    let result: DemoResult<T>;
    try {
      result = await options.send();
    } catch (error) {
      if (isAbortError(error)) throw error;
      result = {
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
    const action: FailureAction = actionForFailure(result);
    if (result.ok || action !== "retry" || extras >= MAX_EXTRA_ATTEMPTS) return result;
    extras += 1;
    const wait = result.retry_after_ms ?? (result.networkError ? 1000 : 10_000);
    await options.sleep(wait);
  }
}
