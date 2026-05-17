import type { ReadonlyDeep } from "type-fest";

export type CrateBaseUrl =
    | "https://docs.rs/"
    | "https://doc.rust-lang.org/"
    | "https://microsoft.github.io/windows-docs-rs/doc/";
export interface CrateUrl {
    /* Base URL of the crate documentation. */
    baseUrl: CrateBaseUrl;
    /* Name of the crate. */
    name: string;
    /* Version of the crate ("<version_number>" | "latest" | "stable" | "nightly"). */
    version: string;
    /* Path segments within the documentation site, including the root module. */
    pathSegments: string[];
    /* Optional fragment identifier (without the leading '#'). */
    fragment?: string;
}

export function getBaseUrlForCrate(crateName: string): CrateUrl["baseUrl"] {
    // NOTE: `test` (https://doc.rust-lang.org/test/) is not included here because
    // it's a nightly-only experimental API behind `#![feature(test)]` at the time
    // of writing.
    switch (crateName) {
        case "std":
        case "core":
        case "alloc":
        case "proc_macro":
            return "https://doc.rust-lang.org/";
        case "windows":
            return "https://microsoft.github.io/windows-docs-rs/doc/";
        default:
            return "https://docs.rs/";
    }
}

export function parseUrl(url: string): CrateUrl | null {
    // Extract fragment (e.g., "#method.block_on") before parsing the base URL.
    const hashIndex = url.indexOf("#");
    const fragment = hashIndex !== -1 ? url.substring(hashIndex + 1) : undefined;
    const baseUrl = hashIndex !== -1 ? url.substring(0, hashIndex) : url;

    // docs.rs URLs: https://docs.rs/{crate}/{version}/{path...}
    if (baseUrl.startsWith("https://docs.rs/") && !(
        baseUrl.startsWith("https://docs.rs/-/") ||
        baseUrl.startsWith("https://docs.rs/crate/")
    )) {
        const [name, version, ...pathSegments] =
            baseUrl
                .substring("https://docs.rs/".length)
                .split("/");
        if (name)
            return {
                baseUrl: "https://docs.rs/",
                name,
                version: version || "latest",
                pathSegments,
                fragment: fragment || undefined,
            };
    }

    // doc.rust-lang.org URLs:
    //   https://doc.rust-lang.org/{std|core|alloc|..}/{path...}
    //   https://doc.rust-lang.org/{stable|nightly}/{std|core|alloc|..}/{path...}
    if (baseUrl.startsWith("https://doc.rust-lang.org/")) {
        const segments =
            baseUrl
                .substring("https://doc.rust-lang.org/".length)
                .split("/");

        // Check for version prefix (stable/nightly).
        let version = "stable";
        if (segments[0] === "stable" || segments[0] === "nightly") {
            version = segments[0];
            segments.shift();
        }

        if (segments[0] &&
            getBaseUrlForCrate(segments[0]) === "https://doc.rust-lang.org/") {
            const name = segments[0];
            return {
                baseUrl: "https://doc.rust-lang.org/",
                name,
                version,
                pathSegments: segments,
                fragment: fragment || undefined,
            };
        }
    }

    // microsoft.github.io/windows-docs-rs URLs:
    //   https://microsoft.github.io/windows-docs-rs/doc/windows/{path...}
    // No versioning in URL - only latest docs are published.
    const windowsDocsBase = "https://microsoft.github.io/windows-docs-rs/doc/";
    if (baseUrl.startsWith(windowsDocsBase)) {
        const segments = baseUrl.substring(windowsDocsBase.length).split("/");
        if (segments[0] &&
            getBaseUrlForCrate(segments[0]) === windowsDocsBase) {
            const name = segments[0];
            return {
                baseUrl: windowsDocsBase,
                name,
                version: "latest",
                pathSegments: segments,
                fragment: fragment || undefined,
            };
        }
    }

    return null;
}

export function buildUrl(crate: ReadonlyDeep<CrateUrl>): string {
    let path = crate.pathSegments.join("/");
    if (!(path === "") &&
        !path.endsWith(".html") &&
        !path.endsWith("/")) {
        path = `${path}/`;
    }
    const fragment = crate.fragment ? `#${crate.fragment}` : "";
    switch (crate.baseUrl) {
        case "https://docs.rs/": {
            // Use "latest" when version is null to avoid malformed URLs like
            // "docs.rs/tokio/null/...".
            const crateName = crate.name;
            const crateVersion = crate.version ?? "latest";
            return `https://docs.rs/${crateName}/${crateVersion}/${path}${fragment}`;
        }
        case "https://doc.rust-lang.org/": {
            switch (crate.version) {
                case "nightly":
                    return `https://doc.rust-lang.org/nightly/${path}${fragment}`;
                default:
                    return `https://doc.rust-lang.org/${path}${fragment}`;
            }
        }
        case "https://microsoft.github.io/windows-docs-rs/doc/": {
            // No versioning in URL - only latest docs are published.
            return `https://microsoft.github.io/windows-docs-rs/doc/${path}${fragment}`;
        }
    }
}
