import { normalizeBaseUrl } from "../../shared/contract.ts";

export type AppConfig = {
  apiKey: string;
  shop: string;
  baseUrl: string;
  port: number;
  fetchImpl?: typeof fetch;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = env.HIOBUY_API_KEY?.trim() ?? "";
  const shop = env.HIOBUY_AI_SHOP?.trim() ?? "";
  if (apiKey && /\s/.test(apiKey)) throw new Error("HIOBUY_API_KEY cannot contain whitespace.");
  if (/[\r\n]/.test(shop)) throw new Error("HIOBUY_AI_SHOP cannot contain line breaks.");
  const port = Number(env.PORT || 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  return {
    apiKey,
    shop,
    baseUrl: normalizeBaseUrl(env.HIOBUY_API_BASE_URL?.trim() || "https://api.hiobuy.com"),
    port,
  };
}
