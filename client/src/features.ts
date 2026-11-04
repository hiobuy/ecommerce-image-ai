import type { FormatType, ImageJobType, PublicFeature, Scene } from "../../shared/contract.ts";

export type FeatureId = "translate" | "remove" | "replace" | "background";

export type Feature = {
  id: FeatureId;
  nav: string;
  title: string;
  description: string;
  endpoint: string;
  feature: PublicFeature;
  imageType?: ImageJobType;
  mark: string;
};

export const FEATURES: Feature[] = [
  {
    id: "translate",
    nav: "Text Translation",
    title: "Text Translation",
    description: "Translate product text into another language.",
    endpoint: "POST /v1/ai/text/translate",
    feature: "text.translate",
    mark: "Aa",
  },
  {
    id: "remove",
    nav: "Remove Chinese Text",
    title: "Remove Chinese Text",
    description: "Remove Chinese text from product images.",
    endpoint: "POST /v1/ai/image/jobs",
    feature: "image.remove_chinese_text",
    imageType: "remove_chinese_text",
    mark: "Tx",
  },
  {
    id: "replace",
    nav: "Translate Image Text",
    title: "Translate Image Text",
    description: "Translate and replace Chinese text inside a product image.",
    endpoint: "POST /v1/ai/image/jobs",
    feature: "image.replace_chinese_text",
    imageType: "replace_chinese_text",
    mark: "Tr",
  },
  {
    id: "background",
    nav: "White Background",
    title: "White Background",
    description: "Create a clean white product background.",
    endpoint: "POST /v1/ai/image/jobs",
    feature: "image.background",
    imageType: "white_background",
    mark: "Wb",
  },
];

export const SOURCE_LANGUAGES = [
  ["auto", "Auto detect"],
  ["zh", "Chinese"],
  ["en", "English"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ar", "Arabic"],
  ["ru", "Russian"],
  ["vi", "Vietnamese"],
  ["th", "Thai"],
  ["id", "Indonesian"],
] as const;

export const TARGET_LANGUAGES = SOURCE_LANGUAGES.filter(([code]) => code !== "auto");

export const SCENE_OPTIONS: { value: Scene; label: string }[] = [
  { value: "e-commerce-title", label: "Product title" },
  { value: "e-commerce-description", label: "Product description" },
  { value: "e-commerce-chat", label: "Customer chat" },
  { value: "e-commerce-cpv", label: "Category, property, and value" },
  { value: "novel", label: "Novel" },
  { value: "game", label: "Game" },
];

export const FORMAT_OPTIONS: { value: FormatType; label: string }[] = [
  { value: "text", label: "Plain text" },
  { value: "html", label: "HTML" },
];

export function featureById(id: FeatureId): Feature {
  const feature = FEATURES.find((item) => item.id === id);
  if (!feature) throw new Error(`Unknown feature ${id}.`);
  return feature;
}
