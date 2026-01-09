// Type declarations for Microsoft WebView2 JavaScript API
declare global {
    interface Window {
        chrome: {
            webview: {
                postMessage(message: string): void;
                addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
                removeEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
            };
        };
    }
}

export {};
