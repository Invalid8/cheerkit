#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startLocalAdmin, type LocalAdminConfig } from "./local-admin.js";

function argumentsFrom(argv: readonly string[]) {
  let configPath = "cheerkit.admin.mjs";
  let port = 0;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: cheerkit-admin [--config path/to/cheerkit.admin.mjs] [--port 0-65535]\n\nThe runner binds to 127.0.0.1. Port 0 chooses an available port.",
      );
      return null;
    }
    if (argument === "--config") {
      const value = argv[++index];
      if (!value) throw new TypeError("--config requires a file path.");
      configPath = value;
    } else if (argument === "--port") {
      const value = argv[++index];
      if (!value || !/^\d+$/.test(value))
        throw new TypeError("--port requires a number from 0 to 65535.");
      port = Number(value);
      if (!Number.isSafeInteger(port) || port > 65_535)
        throw new TypeError("--port requires a number from 0 to 65535.");
    } else {
      throw new TypeError(`Unknown option: ${argument}`);
    }
  }
  return { configPath: resolve(configPath), port };
}

const parsed = argumentsFrom(process.argv.slice(2));
if (parsed) {
  try {
    const loaded = await import(pathToFileURL(parsed.configPath).href);
    const config = (
      typeof loaded.default === "function"
        ? await loaded.default()
        : loaded.default
    ) as LocalAdminConfig;
    const app = await startLocalAdmin(config, { port: parsed.port });
    console.log("Cheerkit local admin is listening on loopback only.");
    console.log(
      `Open this one-use link within five minutes:\n${app.accessUrl}`,
    );
    console.log(
      "Press Ctrl-C to stop and close configured database connections.",
    );
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void app.close().catch(() => {
        console.error("Cheerkit local admin did not shut down cleanly.");
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    console.error(
      "Could not start Cheerkit local admin. Check the config module and database connection.",
    );
    process.exitCode = 1;
  }
}
