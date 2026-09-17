const MARKDOWN_LINK_IN_PARENTHESES = /\(\s*\[([^\]]*)\]\([^)\s]*\)\s*\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)\s]*\)/g;

/**
 * Converts markdown links `[label](url)` into their visible label only,
 * so spoken output and chat history never read URLs aloud.
 * A link alone inside parentheses loses the parentheses as well.
 */
export function stripMarkdownLinks(text: string): string {
  return text
    .replace(MARKDOWN_LINK_IN_PARENTHESES, (_match, label: string) => label)
    .replace(MARKDOWN_LINK, (_match, label: string) => label);
}

export function sanitizeAssistantText(text: string): string {
  return stripMarkdownLinks(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/<\/think>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
