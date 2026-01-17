import type { ReadonlyDeep } from "type-fest";

export type KnownUrl =
    | {
        baseUrl: "https://docs.rs/",
        crateName: string,
        crateVersion: string | null,
        pathSegments: string[],
    }

export function parseUrl(url: string): KnownUrl | null {
    if (url.startsWith("https://docs.rs/") && !(
        url.startsWith("https://docs.rs/-/") ||
        url.startsWith("https://docs.rs/crate/")
    )) {
        const [crateName, crateVersion, ...pathSegments] =
            url
                .substring("https://docs.rs/".length)
                .split("/");
        if (crateName)
            return {
                baseUrl: "https://docs.rs/",
                crateName,
                crateVersion: crateVersion || null,
                pathSegments,
            };
    }

    return null;
}

export function buildUrl(page: ReadonlyDeep<KnownUrl>): string {
    switch (page.baseUrl) {
        case "https://docs.rs/":
        // Use "latest" when version is null to avoid malformed URLs like "docs.rs/tokio/null/..."
        return `https://docs.rs/${page.crateName}/${page.crateVersion ?? "latest"}/${page.pathSegments.join("/")}`;
    }
}
