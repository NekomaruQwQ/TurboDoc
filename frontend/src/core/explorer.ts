import type { Component } from "svelte";
import type { LucideProps } from "@lucide/svelte";

import type { ItemKey } from "@/core/itemKey";

/** A renderable workbench icon. Monochrome SVGs are CSS masks so brand marks
 * can follow the current foreground color. */
export type IconProp =
    | { type: "lucide"; icon: Component<LucideProps> }
    | { type: "monochrome-svg"; src: string };

/** Typography choices supplied by the adapter that rendered an item. */
export interface SourcePresentation {
    /** Whether Explorer item names use the workbench monospace face. */
    readonly renderItemNameAsCode: boolean;
    /** Whether text page names use the workbench monospace face. */
    readonly renderPageNameAsCode: boolean;
}

/** A fresh view derived by one source model. Nothing in this type is persisted. */
export interface SourceView {
    /** Source-local items keyed by their source-local IDs. */
    items: Record<string, SourceItem>;
    /** Optional source-local search behavior. */
    search?: SourceSearchModel;
    /** Optional source-level actions presented by the Explorer. */
    actions?: readonly ExplorerAction[];
}

/** Search behavior contributed by one independently rendered source. */
export interface SourceSearchModel {
    /** Source-local item selected by the accepted navigation URL. */
    activeItemId?: string;
    /** Open an existing source-local item. Stale IDs must be ignored. */
    selectItem(itemId: string): void;
    /** Build a source-specific creation action, or reject the input with null. */
    getAddAction(searchText: string): ExplorerSearchAction | null;
    /** Optional source-owned input action shown for an empty search. */
    emptyAction?: ExplorerInputAction;
}

/** A topic-composed view consumed by generic Explorer components. */
export interface ExplorerView {
    /** Globally keyed items composed in topic source order. */
    items: Record<ItemKey, ExplorerItem>;
    /** Topic presentation plus search behavior from every ready source. */
    search?: ExplorerSearchModel;
    /** Source actions composed in topic source order. */
    actions: readonly ExplorerAction[];
}

/** Topic-wide search behavior after source-local callbacks are composed. */
export interface ExplorerSearchModel {
    /** Placeholder shown while the editable combobox is empty. */
    placeholder: string;
    /** Composite item selected by the accepted navigation URL. */
    activeItemId?: ItemKey;
    /** Open an existing globally keyed item. Stale or malformed keys are ignored. */
    selectItem(itemId: ItemKey): void;
    /** Collect creation actions from ready sources in topic order. */
    getAddActions(searchText: string): readonly ExplorerSearchAction[];
    /** Guidance shown when no item or source action accepts the input. */
    invalidText: string;
    /** Source-owned input actions presented for an empty search. */
    emptyActions: readonly ExplorerInputAction[];
}

/** A source-specific action rendered as a selectable search row. */
export interface ExplorerSearchAction {
    /** User-facing action label. */
    name: string;
    /** Icon distinguishing the action from ordinary item results. */
    icon: IconProp;
    /** Perform the action; asynchronous failures remain visible in search. */
    invoke(): void | Promise<void>;
}

/** A generic Explorer-level action. */
export type ExplorerAction = ExplorerInputAction | ExplorerMenuAction;

/** An action rendered by the generic input-dialog component. */
export interface ExplorerInputAction {
    /** Discriminator for a dialog-backed input action. */
    type: "input";
    /** User-facing action label. */
    name: string;
    /** Action icon. */
    icon: IconProp;
    /** Dialog heading. */
    dialogTitle: string;
    /** Dialog guidance. */
    dialogDescription: string;
    /** Optional field placeholder. */
    placeholder?: string;
    /** Whether the input should accept multiple lines. */
    multiline?: boolean;
    /** Optional confirmation-button label. */
    confirmLabel?: string;
    /** Consume the submitted value. */
    invoke(value: string): void | Promise<void>;
}

/** A simple source-level menu action. */
export interface ExplorerMenuAction {
    /** Discriminator for a callback-only action. */
    type: "menu";
    /** User-facing action label. */
    name: string;
    /** Action icon. */
    icon: IconProp;
    /** Perform the action. */
    invoke(): void | Promise<void>;
}

/** One source-local documentation item returned by an adapter. */
export interface SourceItem {
    /** Identifier unique within the rendering source. */
    id: string;
    /** Display name. */
    name: string;
    /** Adapter-owned ordering key within the source. */
    sortKey: string;
    /** Documentation pages exposed by this item. */
    pages: Page[];
    /** Optional adapter-composed page blocks. */
    pageLayout?: PageLayout;
    /** Optional external links. */
    links?: ItemLink[];
    /** Optional item actions. */
    actions?: ItemAction[];
    /** Optional package-version behavior. */
    versions?: ItemVersions;
}

/** A source item enriched with globally unique Explorer identity. */
export interface ExplorerItem extends Omit<SourceItem, "id"> {
    /** Composite identity persisted by topic-owned UI state. */
    id: ItemKey;
    /** Source that produced this item. */
    sourceId: string;
    /** Original adapter-owned identifier. */
    localItemId: string;
    /** Typography selected by the item's adapter. */
    presentation: SourcePresentation;
}

/** A flat presentation block, independent of collections or book chapters. */
export interface PageBlock {
    /** Unique ID within this layout, including separate spans of one heading. */
    id: string;
    /** Optional flat ancestry used as a display heading. */
    titlePath?: readonly string[];
    /** Ordered references into the owning item's pages. */
    pageUrls: readonly string[];
    /** Whether this block is a pinned-page drop zone. */
    reorderable?: boolean;
    /** Accessible wording for a drop zone. */
    accessibleName?: string;
    /** Optional inline name editor. */
    rename?: PageBlockNameAction;
    /** Optional block removal behavior. */
    remove?: {
        /** Menu and confirmation-button label. */
        label: string;
        /** Optional confirmation text required before invocation. */
        confirmation?: string;
        /** Apply removal against current source state. */
        invoke(): void;
    };
}

/** Complete pinned-page order submitted atomically after cross-block drops. */
export interface PageBlockOrder {
    /** ID of one reorderable block, including empty blocks. */
    id: string;
    /** Every current pinned URL must occur in exactly one block. */
    pageUrls: readonly string[];
}

/** Adapter-owned name validation and persistence for page blocks. */
export interface PageBlockNameAction {
    /** User-facing action, such as "Add collection". */
    label: string;
    /** Current name when renaming; empty when creating. */
    value: string;
    /** Guidance for the inline field. */
    placeholder: string;
    /** Validate and persist the supplied name. */
    invoke(name: string): { blockId: string } | { error: string };
}

/** Adapter-composed flat page list with capability-driven editing. */
export interface PageLayout {
    /** Exact presentation order; headers have no collapse state. */
    blocks: PageBlock[];
    /** Validate a complete snapshot before persisting page movement. */
    reorder?(blocks: readonly PageBlockOrder[]): void;
    /** Optional action displayed after every block. */
    create?: PageBlockNameAction;
}

/** An external link shown in an item's actions menu. */
export interface ItemLink {
    /** Display label. */
    name: string;
    /** HTTPS navigation target. */
    url: string;
    /** Optional custom icon. */
    icon?: IconProp;
}

/** An operation shown in an item's actions menu. */
export interface ItemAction {
    /** Display label. */
    name: string;
    /** Optional action icon. */
    icon?: IconProp;
    /** Whether the action is unavailable. */
    disabled?: true;
    /** Whether the action receives destructive presentation. */
    destructive?: true;
    /** Perform the action. */
    invoke(): void;
}

/** Version choices for a package-like item. */
export interface ItemVersions {
    /** Availability of remotely discovered choices. */
    status: "idle" | "loading" | "ready" | "error";
    /** Human-readable failure detail. */
    error?: string;
    /** All versions grouped by compatibility, newest groups first. */
    all: string[][];
    /** Persisted current selection. */
    current: string;
    /** Preferred first-level menu choices. */
    recommended: string[];
    /** Idempotently request lazy choices after user intent. */
    ensureLoaded?(): void;
    /** Select a version. */
    setCurrentVersion(version: string): void;
}

/** A documentation page rendered under one item. */
export interface Page {
    /** Full name metadata with optional visual abbreviation or alias. */
    name: PageName;
    /** Adapter-owned ordering key. */
    sortKey: string;
    /** Global HTTPS navigation target and page identity. */
    url: string;
    /** Whether accepted navigation belongs to this page. */
    current: boolean;
    /** Pin state, or null when pinning is unavailable. */
    pinned: boolean | null;
    /** Set or clear the pin. */
    setPinned(pinned: boolean): void;
}

/** Text or language-aware symbol page name. */
export type PageName =
    | { type: "text"; text: string }
    | {
        type: "symbol";
        /** Full path to the symbol. */
        path: { type: IdentType; name: string }[];
        /** Separator between symbol path segments. */
        separator: string;
        /** Optional visual abbreviation or single-identifier alias; the full
         * path remains authoritative for ordering, tooltips and accessible
         * labels. Defaults to full; aliases use their identifier type's color. */
        display?: "full" | "leaf" | { type: IdentType; name: string };
    };

/** Language-neutral identifier category used by syntax coloring. */
export type IdentType =
    | "constant"
    | "function"
    | "interface"
    | "macro"
    | "namespace"
    | "type"
    | "unknown";
