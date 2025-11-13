# TurboDoc Frontend Implementation Plan (Simplified Architecture)

## Overview

Implement a full-featured frontend for the docs.rs viewer with **frontend-driven architecture**: all application logic lives in the frontend, backend provides only file I/O and iframe navigation notifications.

## Architecture Simplification

**Key Insight**: Backend doesn't need to understand workspace structure at all!

- Backend: Thin wrapper for file I/O and WebView hosting
- Frontend: All business logic, data parsing, crates.io API calls
- No shared data structures between backend and frontend
- No serialization/deserialization in Rust

## Requirements Summary

- **IPC Communication**: Load/save raw JSON file, notify iframe navigation
- **Explorer UI**: Group-based organization with expandable crate cards showing version selector, metadata links (crates.io, docs.rs, repo), and page tree
- **Page Tree Behavior**: Auto-add new pages as italic/unpinned (VS Code-style), replacing previous unpinned page; user can pin to persist
- **Drag & Drop**: Reorder groups, move crates between groups, reorder pages within crates
- **Delete Confirmations**: Show confirmation dialog for all delete operations (group, crate, page)
- **Metadata Fetching**: Frontend directly queries crates.io API

## Simplified IPC Protocol

### Backend → Frontend (Notifications)

```typescript
type ToFrontendMessage =
  | { type: 'file_loaded', content: string | null, error?: string }
  | { type: 'file_saved', success: boolean, error?: string }
  | { type: 'iframe_navigated', url: string };
```

### Frontend → Backend (Requests)

```typescript
type ToBackendMessage =
  | { type: 'load_file' }
  | { type: 'save_file', content: string };
```

**That's it!** Just 2 request types, 3 response types. No complex data structures.

## Data Model (Frontend Only)

```typescript
// frontend/data.ts
interface DocsPage {
  path: string;        // e.g., "glam/latest/glam/struct.Vec3.html"
  pinned: boolean;     // false = italic/unpinned
}

interface ItemCrate {
  name: string;
  is_expanded: boolean;
  versions: string[];
  current_version: string;
  docs_pages: DocsPage[];
  docs_open_page?: string;
  metadata?: {             // Cached from crates.io
    repository: string | null;
    latest_version: string;
  };
}

interface Group {
  name: string;
  is_expanded: boolean;
  items: Item[];
}

type Item = { type: "crate", data: ItemCrate };

interface Workspace {
  groups: Group[];
}
```

## Implementation Steps

### Phase 1: Backend IPC Foundation (SIMPLIFIED)

**No new modules needed!** Just modify existing files.

#### 1. `src/webview.rs` - Expose `core` field

Change line 16:
```rust
pub(crate) core: ICoreWebView2,
```

#### 2. `src/app.rs` - Add minimal IPC handler

Add simple message handler:

```rust
webview.on_web_message_received({
    let webview = webview.clone();
    let data_dir = DATA_DIR.clone();

    move |message_str| {
        // Parse simple JSON messages
        let message: serde_json::Value = match serde_json::from_str(message_str) {
            Ok(msg) => msg,
            Err(err) => {
                log::error!("failed to parse IPC message: {err}");
                return;
            }
        };

        let msg_type = match message.get("type").and_then(|v| v.as_str()) {
            Some(t) => t,
            None => {
                log::error!("message missing 'type' field");
                return;
            }
        };

        match msg_type {
            "load_file" => {
                let response = load_workspace_file(&data_dir);
                let _ = send_message_to_frontend(&webview, &response);
            },
            "save_file" => {
                if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
                    let response = save_workspace_file(&data_dir, content);
                    let _ = send_message_to_frontend(&webview, &response);
                }
            },
            _ => {
                log::warn!("unknown message type: {msg_type}");
            }
        }
    }
}).unwrap();
```

Add helper functions:

```rust
/// Load workspace file as raw string
fn load_workspace_file(data_dir: &Path) -> String {
    let path = data_dir.join("workspace.json");

    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::json!({
            "type": "file_loaded",
            "content": content,
        }).to_string(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // File doesn't exist - return null content (not an error)
            serde_json::json!({
                "type": "file_loaded",
                "content": null,
            }).to_string()
        },
        Err(err) => serde_json::json!({
            "type": "file_loaded",
            "content": null,
            "error": format!("{err:?}"),
        }).to_string(),
    }
}

/// Save workspace file from raw string
fn save_workspace_file(data_dir: &Path, content: &str) -> String {
    let path = data_dir.join("workspace.json");

    // Create directory if needed
    if let Err(err) = std::fs::create_dir_all(data_dir) {
        return serde_json::json!({
            "type": "file_saved",
            "success": false,
            "error": format!("{err:?}"),
        }).to_string();
    }

    match std::fs::write(&path, content) {
        Ok(()) => serde_json::json!({
            "type": "file_saved",
            "success": true,
        }).to_string(),
        Err(err) => serde_json::json!({
            "type": "file_saved",
            "success": false,
            "error": format!("{err:?}"),
        }).to_string(),
    }
}

/// Send message to frontend via WebView2
fn send_message_to_frontend(webview: &WebView, message: &str) -> anyhow::Result<()> {
    use widestring::U16CString;
    let message_wide = U16CString::from_str(message)
        .context("failed to convert message to U16CString")?;
    unsafe {
        webview.core.PostWebMessageAsString(PCWSTR(message_wide.as_ptr()))
            .context("ICoreWebView2::PostWebMessageAsString failed")?;
    }
    Ok(())
}
```

#### 3. `src/app.rs` - Modify frame navigation handler

Update existing handler to send notification:

```rust
webview.on_frame_navigation_starting({
    let window = Rc::clone(&window);
    let webview = webview.clone();
    move |url, cancel_navigation| {
        log::info!("navigating to {url}");
        if !KNOWN_URL.contains(url) {
            log::info!(" -> external link, navigation cancelled");
            cancel_navigation();
            open_external_link(&window, url);
        } else {
            // Notify frontend of navigation
            let message = serde_json::json!({
                "type": "iframe_navigated",
                "url": url,
            }).to_string();
            let _ = send_message_to_frontend(&webview, &message);
        }
    }
}).unwrap();
```

**That's all for backend!** No new files, no complex types, just ~100 lines of code.

### Phase 2: Frontend IPC Client

#### 1. `frontend/webview2.d.ts` - TypeScript declarations

```typescript
declare global {
  interface Window {
    chrome: {
      webview: {
        postMessage(message: string): void;
        addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
        removeEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
      };
    };
  }
}

export {};
```

#### 2. `frontend/ipc.ts` - IPC client library

```typescript
import type { Workspace } from './data';

// Message types
export type ToBackendMessage =
  | { type: 'load_file' }
  | { type: 'save_file', content: string };

export type ToFrontendMessage =
  | { type: 'file_loaded', content: string | null, error?: string }
  | { type: 'file_saved', success: boolean, error?: string }
  | { type: 'iframe_navigated', url: string };

// Type guard for WebView2 availability
function isWebView2Available(): boolean {
  return typeof window !== 'undefined'
    && 'chrome' in window
    && window.chrome
    && 'webview' in window.chrome;
}

// Send message to backend
export function sendToBackend(message: ToBackendMessage): void {
  if (!isWebView2Available()) {
    console.warn('WebView2 not available, message not sent:', message);
    return;
  }

  window.chrome.webview.postMessage(JSON.stringify(message));
}

// Message handler registry
type MessageHandler = (message: ToFrontendMessage) => void;
const messageHandlers: MessageHandler[] = [];

// Register handler for messages from backend
export function onMessageFromBackend(handler: MessageHandler): () => void {
  messageHandlers.push(handler);

  // Return unsubscribe function
  return () => {
    const index = messageHandlers.indexOf(handler);
    if (index >= 0) {
      messageHandlers.splice(index, 1);
    }
  };
}

// Initialize message listener (call once at app startup)
export function initializeIPC(): void {
  if (!isWebView2Available()) {
    console.warn('WebView2 not available, IPC not initialized');
    return;
  }

  window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
    try {
      const message: ToFrontendMessage = JSON.parse(event.data);

      // Dispatch to all registered handlers
      for (const handler of messageHandlers) {
        handler(message);
      }
    } catch (err) {
      console.error('Failed to parse message from backend:', err);
    }
  });
}

// Workspace-specific helpers
export function loadWorkspace(): void {
  sendToBackend({ type: 'load_file' });
}

export function saveWorkspace(workspace: Workspace): void {
  const content = JSON.stringify(workspace, null, 2);
  sendToBackend({ type: 'save_file', content });
}
```

#### 3. `frontend/crates_io.ts` - Crates.io API client (NEW)

Frontend directly fetches from crates.io:

```typescript
export interface CrateMetadata {
  repository: string | null;
  homepage: string | null;
  documentation: string | null;
  versions: string[];
  max_version: string;
}

interface CratesIoResponse {
  crate: {
    repository: string | null;
    homepage: string | null;
    documentation: string | null;
    max_version: string;
  };
  versions: Array<{ num: string }>;
}

export async function fetchCrateMetadata(crateName: string): Promise<CrateMetadata> {
  const response = await fetch(`https://crates.io/api/v1/crates/${crateName}`, {
    headers: {
      'User-Agent': 'TurboDoc (contact: turbodoc@example.com)',
    },
  });

  if (!response.ok) {
    throw new Error(`crates.io API error: ${response.status} ${response.statusText}`);
  }

  const data: CratesIoResponse = await response.json();

  return {
    repository: data.crate.repository,
    homepage: data.crate.homepage,
    documentation: data.crate.documentation,
    versions: data.versions.map(v => v.num),
    max_version: data.crate.max_version,
  };
}
```

#### 4. `frontend/data.ts` - Extend data model

```typescript
export interface DocsPage {
  path: string;
  pinned: boolean;
}

export interface ItemCrate {
  name: string;
  is_expanded: boolean;
  versions: string[];
  current_version: string;
  docs_pages: DocsPage[];
  docs_open_page?: string;
  metadata?: {
    repository: string | null;
    latest_version: string;
  };
}

export interface Group {
  name: string;
  is_expanded: boolean;
  items: Item[];
}

export type Item = { type: "crate", data: ItemCrate };

export interface Workspace {
  groups: Group[];
}
```

#### 5. `frontend/app.tsx` - Workspace loading and auto-save

```typescript
import { useEffect, useRef, useState } from 'preact/hooks';
import { initializeIPC, loadWorkspace, saveWorkspace, onMessageFromBackend } from './ipc';

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const saveTimeoutRef = useRef<number | null>(null);

  // Initialize IPC on mount
  useEffect(() => {
    initializeIPC();

    // Load workspace from backend
    loadWorkspace();

    // Listen for load response
    return onMessageFromBackend((message) => {
      if (message.type === 'file_loaded') {
        if (message.content) {
          try {
            const loaded = JSON.parse(message.content);
            setWorkspace(loaded);
          } catch (err) {
            console.error('Failed to parse workspace JSON:', err);
            setWorkspace({ groups: [] }); // Fallback to empty
          }
        } else {
          // No workspace file, create default
          setWorkspace({ groups: [] });
        }
        setIsLoading(false);

        if (message.error) {
          console.error('Failed to load workspace:', message.error);
        }
      }
    });
  }, []);

  // Auto-save workspace on changes (debounced)
  useEffect(() => {
    if (!workspace || isLoading) return;

    // Clear existing timeout
    if (saveTimeoutRef.current !== null) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save by 1 second
    saveTimeoutRef.current = setTimeout(() => {
      saveWorkspace(workspace);
    }, 1000) as unknown as number;

    return () => {
      if (saveTimeoutRef.current !== null) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [workspace, isLoading]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <WorkspaceContext.Provider value={[workspace!, setWorkspace]}>
      {/* ... rest of app */}
    </WorkspaceContext.Provider>
  );
}
```

### Phase 3-5: UI Components (Unchanged from original plan)

Explorer UI, drag-and-drop, etc. remain the same - see original plan.

## Critical Files to Modify/Create

**Backend (Rust) - MINIMAL:**
- `src/app.rs` (modify) - Add ~100 lines for IPC handler
- `src/webview.rs` (modify) - Change `core` to `pub(crate)` (1 line)

**Frontend (TypeScript/Preact):**
- `frontend/ipc.ts` (new) - IPC client library
- `frontend/webview2.d.ts` (new) - TypeScript declarations
- `frontend/crates_io.ts` (new) - Crates.io API client
- `frontend/data.ts` (modify) - Add DocsPage type, extend ItemCrate
- `frontend/app.tsx` (modify) - IPC initialization, workspace load/save
- `frontend/explorer/index.tsx` (modify) - Add DndContext, drag handlers
- `frontend/explorer/CrateCard.tsx` (new) - Crate card component
- `frontend/explorer/VersionSelector.tsx` (new) - Version dropdown
- `frontend/explorer/PageTree.tsx` (new) - Page tree with pinning
- `frontend/explorer/Group.tsx` (new) - Group component
- `package.json` (modify) - Add @dnd-kit dependencies

## Benefits of This Architecture

1. **Simpler Backend**: No data models, no serialization, just file I/O
2. **Faster Iteration**: All logic changes in TypeScript, no Rust recompile
3. **No Duplication**: Data structures defined once (frontend only)
4. **Direct API Access**: Frontend calls crates.io directly, no proxy needed
5. **Smaller Binary**: Less Rust code compiled

## Trade-offs

- **No server-side validation**: Backend trusts frontend to write valid JSON
  - Acceptable: This is a single-user local app, not a multi-user service
- **CORS for crates.io**: Must ensure crates.io allows cross-origin requests
  - Crates.io allows CORS, so this works fine

## Implementation Sequence

1. **Backend IPC (30 minutes)**: Modify app.rs and webview.rs
2. **Frontend IPC (1 hour)**: Create ipc.ts, webview2.d.ts, crates_io.ts, modify app.tsx
3. **Explorer UI (3-4 hours)**: Create all component files, test rendering
4. **Page Tree (2 hours)**: Implement VS Code-style pinning, iframe navigation tracking
5. **Drag & Drop (3-4 hours)**: Add @dnd-kit, implement all three drag scenarios
6. **Delete Confirmations (1 hour)**: Add dialogs to all delete buttons
7. **Polish (2-3 hours)**: Error handling UI, loading states, testing

**Total Estimated Time**: 12-15 hours (reduced from 15-20!)

## Success Criteria

- [ ] Workspace loads from JSON on startup
- [ ] Auto-saves workspace 1 second after changes
- [ ] Can add/delete/reorder groups
- [ ] Can add/delete crates with confirmation dialog
- [ ] Crate metadata fetched from crates.io API (directly from frontend)
- [ ] Links to crates.io, docs.rs, repository work
- [ ] Version selector changes current version
- [ ] Iframe navigation auto-adds unpinned page to tree
- [ ] Can pin/unpin pages with italic styling
- [ ] Drag-and-drop reorders groups, crates, pages
- [ ] All delete operations show confirmation dialog
