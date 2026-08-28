import * as _ from "remeda";
import type { Page, PageBlock, PageLayout } from "@/core/explorer";
import { parseUrl } from "./url";

/** Resolve only rustdoc module and item paths for the Windows crate. Unknown
 * URL shapes stay unclassified instead of inventing a namespace. A private URL
 * copy excludes query/fragment navigation state without changing the target. */
function resolveWindowsModulePath(url: string): string | null {
    let candidate: URL;
    try {
        candidate = new URL(url);
    } catch {
        return null;
    }
    candidate.search = "";
    const crate = parseUrl(candidate.href);
    if (crate?.name !== "windows") return null;

    // parseUrl owns this fresh array; remove only the optional trailing slash
    // so malformed interior empty segments still fall back to loose pages.
    const segments = crate.pathSegments;
    if (segments.at(-1) === "") segments.pop();
    const fileName = segments.at(-1);
    if (fileName?.endsWith(".html")) {
        if (fileName !== "index.html" && !/^[a-z]+\.[^.]+\.html$/.test(fileName)) return null;
        segments.pop();
    }
    if (segments[0] !== "windows" ||
        !segments.every(segment => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) return null;
    return segments.join("/");
}

/** Group visible Windows pins and previews by exact module, without fetching
 * a namespace catalog or mutating pages. Home stays first; unclassifiable pages
 * remain visible in an unnamed block. Original URLs, names and pin callbacks
 * are preserved, and pin state never affects placement or alphabetical order. */
export function createWindowsPageLayout(pages: readonly Page[]): PageLayout {
    const home: string[] = [];
    const loose: string[] = [];
    const modules = new Map<string, string[]>();
    // Reuse the flat renderer's sortKey ordering; URL ties keep aliases stable.
    for (const page of _.sortBy(pages, page => page.sortKey, page => page.url)) {
        if (page.pinned === null) {
            home.push(page.url);
            continue;
        }
        const modulePath = resolveWindowsModulePath(page.url);
        if (modulePath === null) {
            loose.push(page.url);
            continue;
        }
        let urls = modules.get(modulePath);
        if (!urls) {
            urls = [];
            modules.set(modulePath, urls);
        }
        urls.push(page.url);
    }

    const blocks: PageBlock[] = [{ id: "home", pageUrls: home }];
    if (loose.length) blocks.push({ id: "", pageUrls: loose });
    for (const [modulePath, pageUrls] of _.sortBy([...modules], ([path]) => path)) {
        blocks.push({
            id: `module:${modulePath}`,
            // The item header already names the crate; root-level blocks stay untitled.
            titlePath: modulePath.split("/").slice(1),
            pageUrls,
        });
    }
    return { blocks };
}
