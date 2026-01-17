import type { ReadonlyDeep } from "type-fest";

export type CrateUrl =
    | {
        baseUrl: "https://docs.rs/",
        name: string,
        version: string,
        pathSegments: string[],
    }
    | {
        baseUrl: "https://doc.rust-lang.org/",
        name: string,
        version: string,
        pathSegments: string[],
    };

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
        default:
            return "https://docs.rs/";
    }
}

export function parseUrl(url: string): CrateUrl | null {
    // docs.rs URLs: https://docs.rs/{crate}/{version}/{path...}
    if (url.startsWith("https://docs.rs/") && !(
        url.startsWith("https://docs.rs/-/") ||
        url.startsWith("https://docs.rs/crate/")
    )) {
        const [name, version, ...pathSegments] =
            url
                .substring("https://docs.rs/".length)
                .split("/");
        if (name)
            return {
                baseUrl: "https://docs.rs/",
                name,
                version: version || "latest",
                pathSegments,
            };
    }

    // doc.rust-lang.org URLs:
    //   https://doc.rust-lang.org/{std|core|alloc|..}/{path...}
    //   https://doc.rust-lang.org/{stable|nightly}/{std|core|alloc|..}/{path...}
    if (url.startsWith("https://doc.rust-lang.org/")) {
        const segments =
            url
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
            };
        }
    }

    return null;
}

export function buildUrl(crate: ReadonlyDeep<CrateUrl>): string {
    let path = crate.pathSegments.join("/");
    if (!path.endsWith(".html") &&
        !path.endsWith("/")) {
        path = `${path}/`;
    }
    switch (crate.baseUrl) {
        case "https://docs.rs/": {
            // Use "latest" when version is null to avoid malformed URLs like
            // "docs.rs/tokio/null/...".
            const crateName = crate.name;
            const crateVersion = crate.version ?? "latest";
            return `https://docs.rs/${crateName}/${crateVersion}/${path}`;
        }
        case "https://doc.rust-lang.org/": {
            switch (crate.version) {
                case "nightly":
                    return `https://doc.rust-lang.org/nightly/${path}`;
                default:
                    return `https://doc.rust-lang.org/${path}`;
            }
        }
    }
}
