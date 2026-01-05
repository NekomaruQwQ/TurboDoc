/**
 * An assertion that throws an Error if the condition is not satisfied.
 * @param condition The boolean condition to check.
 * @param message The message to include in the error if the assertion fails.
 */
export function assert(condition: boolean, message?: string): asserts condition {
    if (!condition) {
        if (message) {
            throw new Error(`Assertion failed: ${message}`);
        } else {
            throw new Error('Assertion failed');
        }
    }
}
