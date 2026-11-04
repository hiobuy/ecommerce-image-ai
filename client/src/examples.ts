import type { ImageJobType } from "../../shared/contract.ts";
import type { FeatureId } from "./features.ts";

export function exampleResponse(feature: FeatureId, imageType?: ImageJobType) {
  if (feature === "translate") {
    return {
      request_id: "req_example",
      job_id: "job_example",
      workspace_id: "aiw_example",
      shop: "SHOP_RETURNED_BY_AI_ACCOUNT",
      credits_used: 0,
      credits_balance: 0,
      character_count: 12,
      translations: [
        {
          translated_text: "Lightweight, breathable cotton summer shirt",
          detected_language: "zh",
          characters: null,
        },
      ],
    };
  }
  return {
    request_id: "req_example",
    job: {
      id: "job_example",
      workspace_id: "aiw_example",
      shop: "SHOP_RETURNED_BY_AI_ACCOUNT",
      type: imageType,
      status: "completed",
      credits_reserved: 0,
      credits_used: 0,
      billing_state: "completed",
      output: { url: "https://cdn.example.com/result.webp" },
    },
  };
}
