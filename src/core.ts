/** Throws an error. Polyfill for environments without `throw` expressions. */
export function throwError(error: string | Error): never {
    if (typeof error === "string") {
        throw new Error(error);
    } else {
        throw error;
    }
}
