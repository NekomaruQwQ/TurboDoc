/** Origin of the WebView2-mapped release artifacts. */
const RELEASE_FRONTEND_ORIGIN = "https://turbodoc.example";
/** Unmapped release origin whose requests reach Rust's WebView2 handler. */
const RELEASE_API_ORIGIN = "https://api.turbodoc.example";

/** Resolve an API path without moving dev requests away from Vite's origin.
 *
 * WebView2 does not raise `WebResourceRequested` for paths claimed by a
 * virtual-host folder mapping. Release requests therefore use a separate
 * intercepted origin, while dev remains same-origin for its Vite boundary. */
export function apiResourceUrl(
    path: string, frontendOrigin = globalThis.location?.origin,
): string {
    const apiOrigin = frontendOrigin === RELEASE_FRONTEND_ORIGIN
        ? RELEASE_API_ORIGIN
        : "";
    return `${apiOrigin}${path}`;
}

/** Build an error that preserves the HTTP status and response body supplied
 * by the in-process REST handler. */
async function responseError(operation: string, response: Response): Promise<Error> {
    const details = await response.text();
    const suffix = details ? `: ${details}` : "";
    return new Error(
        `${operation} failed with ${response.status} ${response.statusText}${suffix}`,
    );
}

/** Persistence load result including whether the TOML resource existed. */
export interface PersistedResource {
    /** Parsed JSON representation; missing files are represented as `{}`. */
    data: unknown;
    /** True only when the backend read an existing file. */
    exists: boolean;
}

/** Header used by the backend to distinguish a missing file from valid `{}`. */
const RESOURCE_EXISTS_HEADER = "x-turbodoc-resource-exists";

/** Parse required persistence metadata without treating a missing CORS-visible
 * header as a missing file, which could otherwise authorize default writes. */
export function parseResourceExistsHeader(value: string | null): boolean {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`Persistence response has invalid ${RESOURCE_EXISTS_HEADER} metadata.`);
}

/** Load one generic root-level application data file such as Explorer UI state. */
export async function loadDataFile(dataId: string): Promise<PersistedResource> {
    return loadResource(
        `/api/data/${encodeURIComponent(dataId)}`,
        "Loading data file");
}

/** Replace one generic root-level data file. */
export async function saveDataFile(dataId: string, data: object): Promise<void> {
    await saveResource(
        `/api/data/${encodeURIComponent(dataId)}`,
        data,
        "Saving data file");
}

/** Load one independently persisted source from `<dataDir>/sources`. */
export async function loadSourceData(sourceId: string): Promise<PersistedResource> {
    return loadResource(
        `/api/sources/${encodeURIComponent(sourceId)}`,
        "Loading source data");
}

/** Replace one independently persisted source file. */
export async function saveSourceData(sourceId: string, data: object): Promise<void> {
    await saveResource(
        `/api/sources/${encodeURIComponent(sourceId)}`,
        data,
        "Saving source data");
}

/** Load a JSON-over-HTTP persistence resource with existence metadata. */
async function loadResource(path: string, operation: string): Promise<PersistedResource> {
    const response = await fetch(apiResourceUrl(path));
    if (!response.ok) throw await responseError(operation, response);
    return {
        data: await response.json(),
        exists: parseResourceExistsHeader(
            response.headers.get(RESOURCE_EXISTS_HEADER)),
    };
}

/** Replace a JSON-over-HTTP persistence resource. */
async function saveResource(
    path: string,
    data: object,
    operation: string,
): Promise<void> {
    const response = await fetch(apiResourceUrl(path), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw await responseError(operation, response);
}
