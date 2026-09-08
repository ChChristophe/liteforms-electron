export function logDiagnostic(line: string): void {
  if (typeof window === "undefined") return;
  // Mirror every renderer log through console.error-capture as well: the main
  // process hooks console-message for every window, which is more reliable than
  // the preload IPC path from inside the bundled renderer (renderer→main invoke
  // silently missed several events during LKG testing).
  try {
    console.log(`[liteforms-diag] ${line}`);
  } catch {
    /* ignore */
  }
  const bridge = window.liteformsElectron;
  if (!bridge?.diagnostic) return;
  void bridge.diagnostic.log(line).catch(() => {
    /* ignore */
  });
}
