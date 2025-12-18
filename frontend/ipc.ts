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

/**
 * Send an `IPCRequest` to the host via WebView2 IPC.
 */
function postRequest(message: IPCRequest): void {
    console.log('[<-] ', message);
    window.chrome.webview.postMessage(JSON.stringify(message));
}

const ipcEventHandlers: {
    [_ in IPCEvent['type']]?: {
        nextId: number;
        [_: number]: (event: IPCEvent) => void;
    };
} = {};

const ipcResponseHandlers: {
    [_ in IPCResponse['type']]?: (response: IPCResponse) => void;
} = {};

/**
 * Initialize global IPC message listener.
 * 
 * This should be called once at app startup.
 */
export function initIPC(): void {
    window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
        const message = event.data as IPCEvent | IPCResponse;
        console.log('[->] ', message);

        const eventHandlers = (ipcEventHandlers as {
            [_: string]: {
                nextId: number;
                [_: number]: (event: IPCEvent) => void;
            };
        })[message.type];
        if (eventHandlers) {
            for (let i = 0; i < eventHandlers.nextId; i++) {
                const handler = eventHandlers[i];
                if (handler) {
                    handler(message as IPCEvent);
                }
            }
        }

        const responseHandler = (ipcResponseHandlers as {
            [_: string]: (response: IPCResponse) => void;
        })[message.type];
        if (responseHandler) {
            responseHandler(message as IPCResponse);
        }
        delete (ipcResponseHandlers as {
            [_: string]: (response: IPCResponse) => void;
        })[message.type];
    });
}

/**
 * Register a handler for a specific `IPCEvent` type, returning a function that
 * removes the handler when called.
 */
export function on<T extends IPCEvent>(
    type: T['type'],
    handler: (event: T) => void): () => void {
    if (ipcEventHandlers[type] === undefined) {
        ipcEventHandlers[type] = { nextId: 0 };
    }

    const handlers = ipcEventHandlers[type]!;
    const id = handlers.nextId++;
    handlers[id] = handler as (event: IPCEvent) => void;
    return () => delete ipcEventHandlers[type]![id];
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
function waitResponse<T extends IPCResponse>(
    type: T['type'],
    timeoutMs = IPC_TIMEOUT_MS): Promise<T> {
    return new Promise((resolve, reject) => {
        if (ipcResponseHandlers[type] !== undefined) {
            throw new Error(`Multiple waiters for IPC response type '${type}'`);
        }

        // Set up timeout to prevent infinite hangs
        const timeout = setTimeout(() => {
            delete ipcResponseHandlers[type];
            reject(new Error(`IPC timeout waiting for ${type} (${timeoutMs}ms)`));
        }, timeoutMs);

        ipcResponseHandlers[type] = (response: IPCResponse) => {
            clearTimeout(timeout);
            delete ipcResponseHandlers[type];
            resolve(response as T);
        };
    });
}

/**
 * Request to load workspace from the host.
 *
 * Returns an empty workspace if the file doesn't exist or on timeout/error.
 */
export async function loadWorkspace(): Promise<Workspace> {
    postRequest({ type: 'load-workspace' });
    try {
        const result = await waitResponse<IPCWorkspaceLoaded>('workspace-loaded');
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
export async function saveWorkspace(workspace: Workspace): Promise<void> {
    postRequest({ type: 'save-workspace', content: JSON.stringify(workspace) });
    const result = await waitResponse<IPCWorkspaceSaved>('workspace-saved');
    if (!result.success) {
        throw new Error(`Failed to save workspace: ${result.message}`);
    }
}

/**
 * Request to load cache from the host.
 *
 * Errors during cache loading are non-fatal, in which case an empty cache is returned.
 * As such, this function never throws.
 */
export async function loadCache(): Promise<Cache> {
    postRequest({ type: 'load-cache' });
    try {
        const result = await waitResponse<IPCCacheLoaded>('cache-loaded');
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
 * Throws an error if save fails or times out.
 */
export async function saveCache(cache: Cache): Promise<void> {
    postRequest({type: 'save-cache', content: JSON.stringify(cache) });
    const result = await waitResponse<IPCCacheSaved>('cache-saved');
    if (!result.success) {
        throw new Error(`Failed to save cache: ${result.message}`);
    }
}
