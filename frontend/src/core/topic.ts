import type {
    ExplorerAction,
    ExplorerInputAction,
    ExplorerItem,
    ExplorerSearchAction,
    ExplorerView,
    IconProp,
    SourceView,
} from "@/core/explorer";
import { createItemKey, parseItemKey } from "@/core/itemKey";
import type { SourceModel } from "@/core/source";

/** Topic-owned wording for the single composed Explorer search field. */
export interface TopicSearchPresentation {
    /** Search-field placeholder. */
    readonly placeholder: string;
    /** Guidance when no item or source action accepts the input. */
    readonly invalidText: string;
}

/** A UI-only grouping of independently persisted and rendered sources. */
export interface Topic {
    /** Stable local UI-state identity. */
    readonly id: string;
    /** Name shown by the navigation rail. */
    readonly name: string;
    /** Rail icon. */
    readonly icon: IconProp;
    /** Source whose home opens on explicit topic selection. */
    readonly homeSourceId: string;
    /** Ordered sources composed by this topic. */
    readonly sources: readonly SourceModel[];
    /** Topic-wide search wording. */
    readonly search: TopicSearchPresentation;
}

/** One ready source paired with the view derived from its current data. */
export interface ReadySourceView {
    /** Compiled source model. */
    readonly model: SourceModel;
    /** Fresh view returned by the model. */
    readonly view: SourceView;
}

/** Return a topic's validated explicit landing target. */
export function getTopicHomeUrl(topic: Topic): string {
    const source = topic.sources.find(candidate => candidate.id === topic.homeSourceId);
    if (!source) {
        throw new Error(
            `Topic "${topic.id}" has unknown home source "${topic.homeSourceId}".`);
    }
    return source.homeUrl;
}

/** Find the first registered topic/source pair that owns a navigation URL. */
export function findTopicForUrl(
    topics: readonly Topic[],
    url: string,
): { topic: Topic; source: SourceModel } | undefined {
    for (const topic of topics) {
        const source = topic.sources.find(candidate => candidate.matchUrl(url));
        if (source) return { topic, source };
    }
    return undefined;
}

/** Compose independently rendered sources into one topic Explorer view.
 *
 * Only ready sources are supplied by the caller. Source order is encoded into
 * each item sort key, while all persisted/UI identities use reversible keys.
 */
export function composeTopicView(
    topic: Topic,
    readySources: readonly ReadySourceView[],
): ExplorerView {
    const items = {} as Record<ReturnType<typeof createItemKey>, ExplorerItem>;
    const sourceById = new Map(readySources.map(source => [source.model.id, source]));
    const actions: ExplorerAction[] = [];
    const emptyActions: ExplorerInputAction[] = [];
    let activeItemId: ReturnType<typeof createItemKey> | undefined;

    for (const [sourceOrder, model] of topic.sources.entries()) {
        const ready = sourceById.get(model.id);
        if (!ready) continue;
        const sourceOrderKey = sourceOrder.toString().padStart(8, "0");

        for (const [localItemId, item] of Object.entries(ready.view.items)) {
            if (item.id !== localItemId) {
                throw new Error(
                    `Source "${model.id}" rendered item "${item.id}" under key "${localItemId}".`);
            }
            const key = createItemKey(model.id, localItemId);
            items[key] = {
                ...item,
                id: key,
                sourceId: model.id,
                localItemId,
                presentation: model.presentation,
                sortKey: `${sourceOrderKey}:${item.sortKey}`,
            };
        }
        actions.push(...ready.view.actions ?? []);
        if (ready.view.search?.emptyAction)
            emptyActions.push(ready.view.search.emptyAction);

        const localActiveId = ready.view.search?.activeItemId;
        const activeKey = localActiveId
            ? createItemKey(model.id, localActiveId)
            : undefined;
        if (!activeItemId && activeKey && activeKey in items) activeItemId = activeKey;
    }

    return {
        items,
        actions,
        search: {
            placeholder: topic.search.placeholder,
            invalidText: topic.search.invalidText,
            activeItemId,
            emptyActions,
            selectItem(itemId) {
                const parsed = parseItemKey(itemId);
                if (!parsed) return;
                sourceById.get(parsed.sourceId)?.view.search?.selectItem(parsed.localItemId);
            },
            getAddActions(searchText: string): readonly ExplorerSearchAction[] {
                return topic.sources.flatMap(model => {
                    const action = sourceById
                        .get(model.id)?.view.search?.getAddAction(searchText);
                    return action ? [action] : [];
                });
            },
        },
    };
}
