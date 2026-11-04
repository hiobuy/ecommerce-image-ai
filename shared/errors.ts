export class InputError extends Error {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export class DemoError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null = null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DemoError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  toBody(): DemoFailure {
    return {
      ok: false,
      status: this.status,
      request_id: this.requestId,
      error: {
        code: this.code,
        message: this.message,
        request_id: this.requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export type NormalizedError = {
  code: string;
  message: string;
  request_id: string | null;
  category?: string;
  details?: Record<string, unknown>;
};

export type DemoFailure = {
  ok: false;
  status: number;
  request_id: string | null;
  retry_after_ms?: number;
  networkError?: boolean;
  error: NormalizedError;
};

export type DemoSuccess<T> = {
  ok: true;
  status: number;
  request_id: string | null;
  data: T;
};

export type DemoResult<T> = DemoSuccess<T> | DemoFailure;
