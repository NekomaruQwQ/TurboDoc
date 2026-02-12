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
export const serverPort = 9680;
export const baseUrl = `http://${serverHost}:${serverPort}`;

/** Directory for storing server-side data and cache. */
export const dataDir = process.env.TURBODOC_DATA
    ?? throwError("TURBODOC_DATA environment variable is not set.");

// == Database ==
import { Database } from "bun:sqlite";

export const dbCache = new Database(`${dataDir}/cache.sqlite`);
dbCache.run("PRAGMA journal_mode = WAL");

// == Logging ==
console.log("JavaScript Runtime:", formatPath(process.execPath));
console.log(`dataDir: ${formatPath(dataDir)}`);
