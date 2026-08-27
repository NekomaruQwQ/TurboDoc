/** Decode defensively because malformed URL escapes must not break rendering. */
export function decodePageSlug(slug: string): string {
    try { return decodeURIComponent(slug); } catch { return slug; }
}

/** Uppercase word initials without damaging the rest of mixed-case words. */
function capitalizeWords(slug: string): string {
    return slug.split(/[-_\s]+/).filter(Boolean)
        .map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}

/** Keep chapter/section numbers while dropping only the Rust Book's ch marker. */
export function resolveRustBookPageName(url: URL): string {
    const file = decodePageSlug(url.pathname.split("/").filter(Boolean).at(-1) ?? "")
        .replace(/\.html$/i, "");
    const numbered = /^ch(\d+-\d+)-(.+)$/.exec(file);
    return numbered ? `${numbered[1]} ${capitalizeWords(numbered[2] ?? "")}`
        : capitalizeWords(file) || "Page";
}

/** Humanize unnumbered filenames; directory indexes use their directory name. */
export function resolveBookPageName(url: URL): string {
    const segments = url.pathname.split("/").filter(Boolean);
    let file = decodePageSlug(segments.pop() ?? "").replace(/\.html$/i, "");
    if (/^(index|README)$/i.test(file)) file = decodePageSlug(segments.pop() ?? "");
    return capitalizeWords(file) || "Page";
}

/** Nomicon terminology has a few deliberate acronym spellings. */
export function resolveNomiconPageName(url: URL): string {
    return resolveBookPageName(url).replace(/\bFfi\b/g, "FFI")
        .replace(/\bHrtb\b/g, "HRTB").replace(/\bObrm\b/g, "OBRM");
}

/** Keep editor names recognizable while still deriving labels from the URL. */
export function resolveAnalyzerPageName(url: URL): string {
    return resolveBookPageName(url).replace(/\bVs Code\b/g, "VS Code")
        .replace(/\bFaq\b/g, "FAQ").replace(/\bLsp\b/g, "LSP")
        .replace(/\bRust Analyzer\b/g, "rust-analyzer");
}

/** Feature pages are identifiers, not prose titles; preserve their spelling. */
export function resolveUnstablePageName(url: URL): string {
    if (/\/(language-features|library-features)\//.test(url.pathname))
        return decodePageSlug(url.pathname.split("/").at(-1) ?? "")
            .replace(/\.html$/i, "").replaceAll("-", "_") || "Page";
    return resolveBookPageName(url);
}
