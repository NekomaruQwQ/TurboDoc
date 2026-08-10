import { describe, expect, test } from "bun:test";

import {
    DeferredNavigation,
    type InitialDocumentLoadState,
    reduceInitialDocumentLoad,
} from "./documentLifecycle";

describe("DeferredNavigation", () => {
    test("uses the initial URL when no request was queued", () => {
        const navigation = new DeferredNavigation();

        expect(navigation.release("https://docs.rs/")).toBe("https://docs.rs/");
    });

    test("coalesces pre-release requests to the newest URL", () => {
        const navigation = new DeferredNavigation();
        navigation.request("https://docs.rs/serde/latest/serde/");
        navigation.request("https://docs.rs/tokio/latest/tokio/");

        expect(navigation.release("https://docs.rs/")).toBe(
            "https://docs.rs/tokio/latest/tokio/",
        );
    });

    test("returns post-release requests immediately", () => {
        const navigation = new DeferredNavigation();
        navigation.release("https://docs.rs/");

        expect(navigation.request("https://doc.rust-lang.org/std/")).toBe(
            "https://doc.rust-lang.org/std/",
        );
    });

    test("ignores duplicate release notifications", () => {
        const navigation = new DeferredNavigation();
        navigation.release("https://docs.rs/");

        expect(navigation.release("https://docs.rs/serde/latest/serde/")).toBeUndefined();
    });
});

describe("reduceInitialDocumentLoad", () => {
    test("accepts completion for the active navigation", () => {
        const loading: InitialDocumentLoadState = {
            status: "loading",
            url: "https://docs.rs/tokio/latest/tokio/",
            navigationId: "8",
        };

        expect(reduceInitialDocumentLoad(loading, {
            type: "completed",
            navigationId: "8",
            success: true,
            error: null,
        })).toEqual({ status: "ready" });
    });

    test("ignores completion from a superseded navigation", () => {
        const loading: InitialDocumentLoadState = {
            status: "loading",
            url: "https://docs.rs/tokio/latest/tokio/",
            navigationId: "9",
        };

        expect(reduceInitialDocumentLoad(loading, {
            type: "completed",
            navigationId: "8",
            success: false,
            error: "cancelled",
        })).toBe(loading);
    });

    test("preserves the failed URL for retry", () => {
        const loading: InitialDocumentLoadState = {
            status: "loading",
            url: "https://docs.rs/tokio/latest/tokio/",
            navigationId: "9",
        };

        expect(reduceInitialDocumentLoad(loading, {
            type: "completed",
            navigationId: "9",
            success: false,
            error: "connection reset",
        })).toEqual({
            status: "error",
            url: "https://docs.rs/tokio/latest/tokio/",
            reason: "failed",
            details: "connection reset",
        });
    });

    test("turns an active load timeout into a retryable error", () => {
        const loading: InitialDocumentLoadState = {
            status: "loading",
            url: "https://docs.rs/tokio/latest/tokio/",
            navigationId: null,
        };

        expect(reduceInitialDocumentLoad(loading, { type: "timed-out" })).toEqual({
            status: "error",
            url: "https://docs.rs/tokio/latest/tokio/",
            reason: "timeout",
            details: null,
        });
    });

    test("retry returns the failed URL to an uncorrelated loading state", () => {
        const failed: InitialDocumentLoadState = {
            status: "error",
            url: "https://docs.rs/tokio/latest/tokio/",
            reason: "failed",
            details: "connection reset",
        };

        expect(reduceInitialDocumentLoad(failed, { type: "retry" })).toEqual({
            status: "loading",
            url: "https://docs.rs/tokio/latest/tokio/",
            navigationId: null,
        });
    });

    test("never restores the placeholder after initial success", () => {
        const ready: InitialDocumentLoadState = { status: "ready" };

        expect(reduceInitialDocumentLoad(ready, {
            type: "started",
            url: "https://docs.rs/serde/latest/serde/",
            navigationId: "10",
        })).toBe(ready);
    });
});
