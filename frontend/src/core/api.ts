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

/** Load one provider's persisted data through the Rust-owned REST resource.
 * Missing provider files are represented by the endpoint as a successful
 * empty object; protocol and server failures reject the promise. */
export async function loadProviderData(providerId: string): Promise<unknown> {
    const response = await fetch(apiResourceUrl(
        `/api/data/${encodeURIComponent(providerId)}`,
    ));
    if (!response.ok) throw await responseError("Loading provider data", response);
    return response.json();
}

/** Replace one provider's persisted data through the Rust-owned REST resource.
 * Protocol and server failures reject the promise so the owning store can
 * report them without treating a failed write as a successful response. */
export async function saveProviderData(
    providerId: string, data: object,
): Promise<void> {
    const response = await fetch(apiResourceUrl(
        `/api/data/${encodeURIComponent(providerId)}`,
    ), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw await responseError("Saving provider data", response);
}
