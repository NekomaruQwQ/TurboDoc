/** The metadata TurboDoc needs to populate a crate's version selector and
 * optional external links, independent of its upstream representation. */
export interface CrateMetadata {
    name: string;
    versions: { num: string; yanked: boolean }[];
    homepage: string | null;
    repository: string | null;
}

/** Build a crates.io sparse-index URL using Cargo's length-sensitive path
 * layout. Crate names are normalized to lowercase because index filenames
 * are lowercase even when a package's declared name contains capitals.
 *
 * @throws {Error} When `name` cannot be a crates.io package name. */
export function getCratesIndexUrl(name: string): string {
    const normalized = normalizeCrateName(name);
    let path: string;
    switch (normalized.length) {
        case 1:
            path = `1/${normalized}`;
            break;
        case 2:
            path = `2/${normalized}`;
            break;
        case 3:
            path = `3/${normalized[0]}/${normalized}`;
            break;
        default:
            path = `${normalized.slice(0, 2)}/${normalized.slice(2, 4)}/${normalized}`;
            break;
    }
    return `https://index.crates.io/${path}`;
}

/** Build the real-time crates.io API URL used only by explicit refreshes.
 *
 * @throws {Error} When `name` cannot be a crates.io package name. */
export function getCratesApiUrl(name: string): string {
    return `https://crates.io/api/v1/crates/${normalizeCrateName(name)}`;
}

/** Parse a newline-delimited sparse-index file. Each nonempty line describes
 * one published version; unknown fields are intentionally ignored because
 * dependency resolution metadata is irrelevant to TurboDoc.
 *
 * @throws {Error} If any record is malformed, belongs to another crate, or
 * the file contains no version records. Rejecting the whole document avoids
 * silently presenting an incomplete version list. */
export function parseCratesIndex(name: string, body: string): CrateMetadata {
    const expectedName = normalizeCrateName(name);
    let canonicalName: string | null = null;
    const versions: CrateMetadata["versions"] = [];

    for (const [index, line] of body.split(/\r?\n/).entries()) {
        if (line.trim().length === 0) continue;
        const entry = parseJsonObject(line, `index line ${index + 1}`);
        if (typeof entry.name !== "string" ||
            typeof entry.vers !== "string" ||
            typeof entry.yanked !== "boolean") {
            throw new Error(`Malformed crates index record on line ${index + 1}.`);
        }
        if (entry.name.toLowerCase() !== expectedName) {
            throw new Error(`Crates index returned metadata for ${entry.name}, expected ${name}.`);
        }
        canonicalName ??= entry.name;
        versions.push({ num: entry.vers, yanked: entry.yanked });
    }

    if (!canonicalName)
        throw new Error(`Crates index returned no versions for ${name}.`);
    return {
        name: canonicalName,
        versions,
        homepage: null,
        repository: null,
    };
}

/** Parse the richer crates.io API representation returned by an explicit
 * metadata refresh.
 *
 * @throws {Error} If required crate or version fields are malformed. */
export function parseCratesApi(body: string): CrateMetadata {
    const response = parseJsonObject(body, "crates.io API response");
    const crate = asObject(response.crate);
    if (!crate || typeof crate.name !== "string" || !Array.isArray(response.versions))
        throw new Error("Malformed crates.io API response.");

    const versions = response.versions.map((value, index) => {
        const version = asObject(value);
        if (!version || typeof version.num !== "string")
            throw new Error(`Malformed crates.io API version at index ${index}.`);
        if (version.yanked !== undefined && typeof version.yanked !== "boolean")
            throw new Error(`Malformed crates.io API yanked flag at index ${index}.`);
        return { num: version.num, yanked: version.yanked ?? false };
    });

    return {
        name: crate.name,
        versions,
        homepage: optionalString(crate.homepage),
        repository: optionalString(crate.repository),
    };
}

/** Validate and normalize names before placing them into upstream URLs.
 * crates.io requires an ASCII alphabetic first character, followed by at
 * most 63 ASCII alphanumeric, hyphen, or underscore characters. */
function normalizeCrateName(name: string): string {
    const normalized = name.toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized))
        throw new Error(`Invalid crates.io crate name: ${name}`);
    return normalized;
}

/** Parse JSON while preserving a useful source label in diagnostics. */
function parseJsonObject(source: string, label: string): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(source);
    } catch (cause) {
        throw new Error(`Malformed ${label}.`, { cause });
    }
    const object = asObject(value);
    if (!object) throw new Error(`Malformed ${label}.`);
    return object;
}

/** Narrow unknown JSON objects without accepting arrays or null. */
function asObject(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/** Normalize optional URL-like API fields; unexpected values are ignored
 * because they do not affect the required version metadata. */
function optionalString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}
