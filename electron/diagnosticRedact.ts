const openAiKeyPattern = /sk-[A-Za-z0-9_-]{8,}/g;
const bearerPattern = /bearer\s+\S+/gi;
const credentialKeyPattern = /((?:credential|api[_-]?key|token|secret|password|authorization)["'=:\s]+)[^\s"'&,}]+/gi;

export function redactDiagnosticLine(line: string): string {
  return line
    .replace(openAiKeyPattern, "sk-***")
    .replace(bearerPattern, "Bearer ***")
    .replace(credentialKeyPattern, "$1***");
}
