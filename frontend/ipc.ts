import type { PartialDeep, ReadonlyDeep } from 'type-fest';

import { assert } from '@/prelude';

import type { Workspace, Cache } from '@/data';
import { IPC_TIMEOUT_MS } from '@/constants';

const EMPTY_WORKSPACE = { groups: [], ungrouped: [] } satisfies Workspace;
const EMPTY_CACHE = { crates: {} } satisfies Cache;

/**
 * IPC message representing an event occurring on the host side.
 */
type IPCEvent =
    | { type: 'navigated', url: string };

/**
 * IPC message that requests an action to be performed on the host side,
 * typically involving file I/O.
 *
 * Each request expects a corresponding `IPCResponse` from the host.
 */
type IPCRequest =
    | { type: 'load-workspace' }
    | { type: 'save-workspace', content: string }
    | { type: 'load-cache' }
    | { type: 'save-cache', content: string };

/**
 * IPC message representing a response from the host to a previously
 * sent `IPCRequest`.
 */
type IPCResponse =
    | IPCWorkspaceLoaded
    | IPCWorkspaceSaved
    | IPCCacheLoaded
    | IPCCacheSaved;
type IPCResponseBase<T> =
    | { success: true } & T
    | { success: false, message: string };

type IPCWorkspaceLoaded =
    { type: 'workspace-loaded' } & IPCResponseBase<{ content: string | null }>;
type IPCWorkspaceSaved =
    { type: 'workspace-saved' } & IPCResponseBase<{}>;
type IPCCacheLoaded =
    { type: 'cache-loaded' } & IPCResponseBase<{ content: string | null }>;
type IPCCacheSaved =
    { type: 'cache-saved' } & IPCResponseBase<{}>;

/** Handler funciton for a specific IPCEvent type */
type IPCEventHandler =
    (event: ReadonlyDeep<IPCEvent>) => void;
/** Handler function for a specific IPCResponse type */
type IPCResponseHandler =
    (response: ReadonlyDeep<IPCResponse>) => void;

class IPC {
    private static instance: IPC | null = null;

    public static getInstance(): IPC {
        if (!IPC.instance) {
            IPC.instance = new IPC();
            window.chrome.webview.addEventListener('message', (event) => {
                IPC.instance!.handleMessage(event);
            });
            console.log('IPC ready.');
        }

        return IPC.instance;
    }

    private readonly eventHandlerMap:
        Partial<Record<IPCEvent['type'], Set<IPCEventHandler>>> = {};
    private readonly responseHandlerMap:
        Partial<Record<IPCResponse['type'], IPCResponseHandler>> = {};

    private handleMessage(event: MessageEvent): void {
        // Here we assume that the host always send well-formed messages and omit any type
        // checking here for simplicity.
        const message = event.data as IPCEvent | IPCResponse;

        console.log('[->] ', message);

        const eventHandlerMap =
            (this.eventHandlerMap as Partial<Record<string, Set<IPCEventHandler>>>);
        const eventHandlers =
            eventHandlerMap[message.type];
        if (eventHandlers) {
            for (const handler of eventHandlers) {
                handler(message as IPCEvent);
            }
        }

        const responseHandlerMap =
            (this.responseHandlerMap as Partial<Record<string, IPCResponseHandler>>);
        const responseHandler =
            responseHandlerMap[message.type];
        if (responseHandler) {
            responseHandler(message as IPCResponse);
        }

        delete responseHandlerMap[message.type];
    }

    /**
     * Register a handler for a specific `IPCEvent`, returning a function that
     * removes the handler when called.
     */
    public on<T extends IPCEvent>(type: T['type'], handler: (event: T) => void): () => void {
        if (this.eventHandlerMap[type] === undefined) {
            this.eventHandlerMap[type] = new Set();
        }

        const handlerCasted = handler as (event: IPCEvent) => void;
        const handlerMap = this.eventHandlerMap[type]!;
        handlerMap.add(handlerCasted);
        return () => handlerMap.delete(handlerCasted);
    }

    /**
     * Wait for a `IPCResponse` of the specified `type` from the host.
     *
     * Waiting for a response that is already being waited on is considered an error.
     *
     * @param type - The response type to wait for
     * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
     * @returns Promise that resolves with the response or rejects on timeout
     */
    public getResponseAsync<T extends IPCResponse>(
        type: T['type'],
        timeoutMs = IPC_TIMEOUT_MS): Promise<T> {
        return new Promise((resolve, reject) => {
            assert(
                this.responseHandlerMap[type] === undefined,
                `Multiple waiters for IPC response type '${type}'`);

            // Set up timeout to prevent infinite hangs
            const timeout = setTimeout(() => {
                delete this.responseHandlerMap[type];
                reject(new Error(`IPC timeout waiting for ${type} (${timeoutMs}ms)`));
            }, timeoutMs);

            this.responseHandlerMap[type] = (response: IPCResponse) => {
                clearTimeout(timeout);
                delete this.responseHandlerMap[type];
                resolve(response as T);
            };
        });
    }
}

/**
 * Send a message to the host via WebView2 IPC.
 */
function postMessage(message: ReadonlyDeep<IPCRequest>): void {
    console.log('[<-] ', message);
    window.chrome.webview.postMessage(JSON.stringify(message));
}

/**
 * Request to load workspace from the host.
 *
 * Returns an empty workspace if the file doesn't exist or on timeout/error.
 */
export async function loadWorkspace(): Promise<Workspace> {
    try {
        postMessage({ type: 'load-workspace' });
        const result = await (
            IPC
                .getInstance()
                .getResponseAsync<IPCWorkspaceLoaded>('workspace-loaded'));
        if (result.success) {
            // Handle null/empty content (workspace file doesn't exist yet)
            if (result.content) {
                return JSON.parse(result.content) as Workspace;
            } else {
                return EMPTY_WORKSPACE;
            }
        } else {
            throw new Error(`Failed to load workspace: ${result.message}`);
        }
    } catch (err) {
        throw new Error(`Failed to load workspace: ${err}`);
    }
}

/**
 * Request to save workspace to the host.
 *
 * Throws an error if save fails or times out.
 */
export async function saveWorkspace(workspace: ReadonlyDeep<PartialDeep<Workspace>>): Promise<void> {
    try {
        postMessage({ type: 'save-workspace', content: JSON.stringify(workspace) });
        const result = await (
            IPC
                .getInstance()
                .getResponseAsync<IPCWorkspaceSaved>('workspace-saved'));
        if (!result.success) {
            throw new Error(`Failed to save workspace: ${result.message}`);
        }
    } catch (err) {
        throw new Error(`Failed to save workspace: ${err}`);
    }
}

/**
 * Request to load cache from the host.
 *
 * Errors during cache loading are non-fatal, in which case an empty cache is returned.
 * As such, this function never throws.
 */
export async function loadCache(): Promise<Cache> {
    try {
        postMessage({ type: 'load-cache' });
        const result = await (
            IPC
                .getInstance()
                .getResponseAsync<IPCCacheLoaded>('cache-loaded'));
        if (result.success) {
            if (result.content) {
                return JSON.parse(result.content) as Cache;
            }
        } else {
            console.error(`Failed to load cache: ${result.message}`);
        }
    } catch (err) {
        console.error('Failed to load cache:', err);
    }

    return EMPTY_CACHE;
}

/**
 * Request to save cache to the host.
 *
 * Failures during cache saving are non-fatal, and as such, this function never throws.
 */
export async function saveCache(cache: ReadonlyDeep<PartialDeep<Cache>>): Promise<void> {
    try {
        postMessage({type: 'save-cache', content: JSON.stringify(cache) });
        const result = await (
            IPC
                .getInstance()
                .getResponseAsync<IPCCacheSaved>('cache-saved'));
        if (!result.success) {
            console.error(`Failed to save cache: ${result.message}`);
        }
    } catch (err) {
        console.error(`Failed to save cache: ${err}`);
    }
}
