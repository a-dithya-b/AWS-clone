/**
 * Node prints an "experimental" warning the first time node:sqlite loads. It's expected and would
 * only confuse learners, so hide that one warning. Must run before node:sqlite is imported.
 */
export function silenceSqliteWarning() {
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/SQLite is an experimental feature/.test(text)) return;
    return (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
