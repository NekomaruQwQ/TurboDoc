import type { Workspace } from '@/data';

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
    | { type: 'save-workspace', content: string };

/**
 * IPC message representing a response from the host to a previously
 * sent `IPCRequest`.
 */
type IPCResponse =
    | IPCWorkspaceLoaded
    | IPCWorkspaceSaved;

type IPCWorkspaceLoaded =
    { type: 'workspace-loaded' } & (
        | { success: true, content: string }
        | { success: false, message: string });
type IPCWorkspaceSaved =
    { type: 'workspace-saved' } & (
        | { success: true }
        | { success: false, message: string });

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
 */
function waitResponse<T extends IPCResponse>(type: T['type']): Promise<T>  {
    return new Promise(resolve => {
        if (ipcResponseHandlers[type] === undefined) {
            ipcResponseHandlers[type] =
                (response: IPCResponse) => {
                    resolve(response as T);
                    delete ipcResponseHandlers[type];
                };
        } else {
            throw new Error(`Multiple waiters for IPC response type '${type}'`);
        }
    });
}

/**
 * Request to load workspace from the host.
 */
export async function loadWorkspace(): Promise<Workspace> {
    postRequest({ type: 'load-workspace' });
    const result = await waitResponse<IPCWorkspaceLoaded>('workspace-loaded');
    if (result.success) {
        return JSON.parse(result.content) as Workspace;
    } else {
        throw new Error(`Failed to load workspace: ${result.message}`);
    }
}

/**
 * Request to save workspace to the host.
 */
export async function saveWorkspace(workspace: Workspace): Promise<void> {
    postRequest({ type: 'save-workspace', content: JSON.stringify(workspace) });
    const result = await waitResponse<IPCWorkspaceSaved>('workspace-saved');
    if (!result.success) {
        throw new Error(`Failed to save workspace: ${result.message}`);
    }
}
