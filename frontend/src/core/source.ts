import type { SourcePresentation, SourceView } from "@/core/explorer";

/** Source IDs share the backend's safe, single-path-segment contract. */
export const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Result of interpreting one source persistence resource. */
export interface SourceDataInitialization<D extends object> {
    /** Valid source-specific state exposed through a reactive store. */
    data: D;
    /** Whether the initialized value should be written without a user edit. */
    persist: boolean;
}

/** A code-defined source: one adapter paired with source-specific rules. */
export interface SourceDefinition<D extends object, R> {
    /** Globally unique persistence and routing ID. */
    readonly id: string;
    /** User-facing source name. */
    readonly name: string;
    /** Logic that compiles exactly this definition. */
    readonly adapter: Adapter<D, R>;
    /** Data-only configuration and policy callbacks consumed by the adapter. */
    readonly rules: R;
}

/** Logic shared by compatible sources. */
export interface Adapter<D extends object, R> {
    /** Compile one definition into its runtime source model. */
    resolve(definition: SourceDefinition<D, R>): SourceModel<D>;
}

/** Reactive input passed to a source model's pure render function. */
export interface SourceModelContext<D extends object> {
    /** Source-specific flattened persistence data. */
    readonly data: D;
    /** Current accepted document URL. */
    readonly currentUrl: string;
    /** Navigate the shared document viewer. */
    navigateTo(url: string): void;
}

/** Runtime model produced by `Adapter.resolve`.
 *
 * The model is conceptually a source ViewModel: it validates persistence,
 * matches navigation, and derives a fresh `SourceView` with behavior.
 */
export interface SourceModel<D extends object = object> {
    /** Globally unique source and persistence ID. */
    readonly id: string;
    /** User-facing source name. */
    readonly name: string;
    /** Canonical source landing page. */
    readonly homeUrl: string;
    /** Item/page typography applied to this source's rendered items. */
    readonly presentation: SourcePresentation;
    /** Validate persisted JSON or initialize a genuinely missing resource. */
    initializeData(raw: unknown, exists: boolean): SourceDataInitialization<D>;
    /** Return whether this source structurally owns the supplied URL. */
    matchUrl(url: string): boolean;
    /** Derive a fresh view without persistence or other side effects. */
    render(context: SourceModelContext<D>): SourceView;
    /** Optionally bind source-specific reactive effects to the Explorer host. */
    setupEffects?(context: SourceModelContext<D>): void;
}

/** Compile a definition through the adapter meaningful to that source. */
export function resolveSource<D extends object, R>(
    definition: SourceDefinition<D, R>,
): SourceModel<D> {
    if (!SOURCE_ID_PATTERN.test(definition.id)) {
        throw new Error(`Source ID "${definition.id}" is not a valid source identifier.`);
    }
    if (!definition.name.trim()) {
        throw new Error(`Source "${definition.id}" must have a display name.`);
    }
    const model = definition.adapter.resolve(definition);
    if (model.id !== definition.id) {
        throw new Error(
            `Adapter changed source ID "${definition.id}" to "${model.id}".`);
    }
    return model;
}
