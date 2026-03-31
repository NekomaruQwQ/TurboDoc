// == Utility ==
/** Throws an error. Polyfill for environments without `throw` expressions. */
export function throwError(error: string | Error): never {
    if (typeof error === "string") {
        throw new Error(error);
    } else {
        throw error;
    }
}

/** Formats a filesystem path for logging, replacing backslashes with slashes. */
export const formatPath = (path: string) => path.replaceAll("\\", "/");

// == Config ==
export const serverHost = "localhost";
export const serverPort =
    Number(process.env.TURBODOC_PORT)
        || throwError("TURBODOC_PORT is required to start the server.");

/** Directory for storing server-side data and cache. */
export const dataDir =
    process.env.TURBODOC_DATA
        || throwError("TURBODOC_DATA is required to start the server.");

// == Database ==
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/// Ensure the data directory exists before opening the database.
mkdirSync(dataDir, { recursive: true });
export const dbCache = new Database(`${dataDir}/cache.sqlite`);
dbCache.run("PRAGMA journal_mode = WAL");

// == Logging ==
console.log("JavaScript Runtime:", formatPath(process.execPath));
console.log(`dataDir: ${formatPath(dataDir)}`);
