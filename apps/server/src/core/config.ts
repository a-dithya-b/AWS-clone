import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Folder with the built web app, served by the server when it exists. */
  webDir: string;
}

const HELP = `CloudLearn: a local simulator for learning AWS.

Options:
  --port <n>         Port to listen on (default 4747, or $PORT)
  --host <host>      Interface to bind (default 127.0.0.1)
  --data-dir <path>  Where your simulated account data lives (default ~/.cloudlearn)
  -h, --help         Show this help
`;

export function loadConfig(argv = process.argv.slice(2)): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      "web-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const port = Number(values.port ?? process.env.PORT ?? 4747);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);

  return {
    host: values.host ?? process.env.HOST ?? "127.0.0.1",
    port,
    dataDir: resolve(
      values["data-dir"] ?? process.env.CLOUDLEARN_DATA_DIR ?? join(homedir(), ".cloudlearn"),
    ),
    webDir: resolve(values["web-dir"] ?? fileURLToPath(new URL("./public", import.meta.url))),
  };
}
