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
    const response = await fetch(`/api/data/${encodeURIComponent(providerId)}`);
    if (!response.ok) throw await responseError("Loading provider data", response);
    return response.json();
}

/** Replace one provider's persisted data through the Rust-owned REST resource.
 * Protocol and server failures reject the promise so the owning store can
 * report them without treating a failed write as a successful response. */
export async function saveProviderData(
    providerId: string, data: object,
): Promise<void> {
    const response = await fetch(`/api/data/${encodeURIComponent(providerId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw await responseError("Saving provider data", response);
}
