import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";

/**
 * Extract text content from message content (handles both string and array)
 */
export function getTextContent(content?: string | ChatCompletionContentPart[]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  // For content arrays, extract and concatenate text parts
  return content
    .filter(item => item.type === "text")
    .map(item => "text" in item ? item.text : "")
    .join(" ");
}
