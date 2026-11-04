import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  assertJobId,
  buildEstimateBody,
  buildImageJobBody,
  buildTranslateBody,
  selectPublicPrices,
} from "../../shared/contract.ts";
import { DemoError, InputError, type DemoResult } from "../../shared/errors.ts";
import { readRequestId, scrubSecrets } from "../../shared/scrub.ts";
import type { AppConfig } from "./config.ts";
import { createHiobuyClient } from "./upstream.ts";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createApp(config: AppConfig, options?: { clientDist?: string }) {
  const client = createHiobuyClient(config);
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    res.on("finish", () => {
      if (!req.path.startsWith("/api")) return;
      console.info(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode }));
    });
    next();
  });

  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/session", wrap(async (_req, res) => {
    if (!config.apiKey || !config.shop) {
      send(res, 200, emptySession(false, notConfigured()));
      return;
    }
    try {
      await client.ensureAccount();
      const [balanceResult, pricingResult] = await Promise.all([client.getCredits(), client.getPricing()]);
      const balance = balanceResult.ok ? readBalance(balanceResult.data) : null;
      const prices = pricingResult.ok ? selectPublicPrices(readRules(pricingResult.data)) : [];
      const error = !balanceResult.ok ? balanceResult.error : !pricingResult.ok ? pricingResult.error : null;
      send(res, 200, {
        ok: true,
        configured: true,
        account_ok: true,
        shop: config.shop,
        balance: balance?.credits_balance ?? null,
        balance_request_id: balance?.request_id ?? balanceResult.request_id,
        prices,
        error,
      });
    } catch (error) {
      if (error instanceof DemoError) {
        send(res, 200, emptySession(true, error.toBody().error));
        return;
      }
      throw error;
    }
  }));

  router.get("/credits", wrap(async (_req, res) => {
    const result = await client.getCredits();
    if (!result.ok) return send(res, httpStatus(result), result);
    const balance = readBalance(result.data);
    send(res, result.status, { ok: true, status: result.status, request_id: balance.request_id, data: result.data });
  }));

  router.post("/estimate", wrap(async (req, res) => {
    const source = readObject(req);
    const body = buildEstimateBody({
      feature: source.feature,
      texts: source.texts,
      source_language: source.source_language,
      target_language: source.target_language,
      format_type: source.format_type,
      scene: source.scene,
    });
    const result = await client.estimate(body);
    forward(res, result);
  }));

  router.post("/translate", wrap(async (req, res) => {
    const source = readObject(req);
    const body = buildTranslateBody({
      texts: source.texts,
      source_language: source.source_language,
      target_language: source.target_language,
      format_type: source.format_type,
      scene: source.scene,
    });
    const result = await client.translate(body, readIdempotency(req));
    forward(res, result);
  }));

  router.post("/image-jobs", wrap(async (req, res) => {
    const source = readObject(req);
    const body = buildImageJobBody({
      type: source.type,
      image_url: source.image_url,
      target_language: source.target_language,
    });
    const result = await client.createImageJob(body, readIdempotency(req));
    forward(res, result);
  }));

  router.get("/jobs/:jobId", wrap(async (req, res) => {
    const result = await client.getJob(assertJobId(req.params.jobId));
    forward(res, result);
  }));

  router.get("/assets/:jobId", wrap(async (req, res) => {
    const result = await client.getAsset(assertJobId(req.params.jobId));
    if (!result.ok) return send(res, httpStatus(result), result);
    if (!result.bytes) {
      send(res, 502, new DemoError(502, "DEMO_BAD_RESPONSE", "The asset response did not include an image.").toBody());
      return;
    }
    res.status(result.status);
    res.setHeader("Content-Type", result.contentType || "image/webp");
    res.setHeader("Content-Disposition", `attachment; filename="${assertJobId(req.params.jobId)}.webp"`);
    res.send(Buffer.from(result.bytes));
  }));

  router.use((_req, res) => {
    send(res, 404, {
      ok: false,
      status: 404,
      request_id: null,
      error: {
        code: "NOT_FOUND",
        message: "This demo server does not proxy arbitrary requests.",
        request_id: null,
      },
    });
  });

  app.use("/api", router);

  if (process.env.NODE_ENV === "production" && options?.clientDist) {
    const clientDist = options.clientDist;
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(clientDist, "index.html"), (error) => {
        if (error) next();
      });
    });
  }

  app.use((_req, res) => {
    send(res, 404, {
      ok: false,
      status: 404,
      request_id: null,
      error: { code: "NOT_FOUND", message: "Not found.", request_id: null },
    });
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (isJsonParseError(error)) {
      send(res, 400, new DemoError(400, "VALIDATION_ERROR", "Request body must be valid JSON.").toBody());
      return;
    }
    if (error instanceof InputError) {
      send(res, 400, new DemoError(400, error.code, error.message).toBody());
      return;
    }
    if (error instanceof DemoError) {
      send(res, error.status, error.toBody());
      return;
    }
    const message = error instanceof Error ? error.message : "unknown";
    console.error(JSON.stringify({ where: "demo", message: scrubSecrets(message, [config.apiKey]) }));
    send(res, 500, new DemoError(500, "DEMO_PROXY_ERROR", "The local demo server could not complete the request.").toBody());
  });

  return app;

  function send(res: Response, status: number, body: unknown) {
    res.status(status).json(scrubSecrets(body, [config.apiKey]));
  }

  function forward(res: Response, result: DemoResult<unknown>) {
    send(res, httpStatus(result), result);
  }
}

function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function httpStatus(result: DemoResult<unknown>): number {
  if (result.ok) return result.status || 200;
  return result.status >= 400 ? result.status : 502;
}

function readObject(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new InputError("JSON object body is required.");
  }
  return req.body as Record<string, unknown>;
}

function readIdempotency(req: Request): string {
  const key = req.get("x-idempotency-key");
  if (!key || key.length > 255 || /[\r\n]/.test(key)) {
    throw new InputError("X-Idempotency-Key must be 1 to 255 characters without line breaks.");
  }
  return key;
}

function readRules(data: unknown): unknown {
  if (!data || typeof data !== "object") return [];
  return (data as { rules?: unknown }).rules ?? [];
}

function readBalance(data: unknown): { credits_balance: number; request_id: string | null } {
  if (!data || typeof data !== "object" || typeof (data as { credits_balance?: unknown }).credits_balance !== "number") {
    throw new DemoError(502, "DEMO_BAD_RESPONSE", "GET /v1/ai/credits did not return credits_balance.");
  }
  const body = data as { credits_balance: number; request_id?: unknown };
  return { credits_balance: body.credits_balance, request_id: readRequestId(body.request_id) };
}

function notConfigured() {
  return {
    code: "DEMO_NOT_CONFIGURED",
    message: "Set HIOBUY_API_KEY and HIOBUY_AI_SHOP in the server environment.",
    request_id: null,
  };
}

function emptySession(configured: boolean, error: { code: string; message: string; request_id: string | null }) {
  return {
    ok: true,
    configured,
    account_ok: false,
    shop: null,
    balance: null,
    balance_request_id: error.request_id,
    prices: [],
    error,
  };
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError && "status" in error && (error as { status?: number }).status === 400;
}
