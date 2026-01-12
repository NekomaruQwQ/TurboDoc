import type { ReadonlyDeep } from "type-fest";

export type CratePage =
    | {
        baseUrl: "https://docs.rs/",
        crateName: string,
        crateVersion: string | null,
        pathSegments: string[],
    }

export function parseUrl(url: string): CratePage | null {
    if (url.startsWith("https://docs.rs/")) {
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

export function buildUrl(page: ReadonlyDeep<CratePage>): string {
    switch (page.baseUrl) {
        case "https://docs.rs/":
        return `https://docs.rs/${page.crateName}/${page.crateVersion}/${page.pathSegments.join("/")}`;
    }
}
