// Entry point. main.ts is loaded dynamically so the warning filter is in place before node:sqlite loads.
import { silenceSqliteWarning } from "./core/warnings";

silenceSqliteWarning();
await import("./main");
