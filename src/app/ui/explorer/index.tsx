import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import type { Item } from "@/app/core/data";
import providers from "@/app/providers";
import {
    ProviderProvider,
    useAppContext,
    useProvider,
    useProviderData,
} from "@/app/core/context";

import ExplorerItem from "@/app/ui/explorer/ExplorerItem";
import ExplorerGroupHeader from "@/app/ui/explorer/ExplorerGroupHeader";
import ExplorerCreateGroupComponent from "@/app/ui/explorer/ExplorerCreateGroupComponent";

export default function Explorer() {
    const ctx = useAppContext();
    const app = ctx.workspace.app;
    const preset = app.presets[app.currentPreset];
    return (
        <div
            className="flex flex-col w-full h-full gap-1 rounded overflow-y-scroll"
            style={{ scrollbarWidth: "none" }}>
            {preset?.providers
                .map(providerId => providers[providerId])
                .map(provider => provider && (
                    <ProviderProvider key={provider.id} value={provider}>
                        <ExplorerProvider />
                    </ProviderProvider>
                ))}
        </div>);
}

function ExplorerProvider() {
    const ctx = useAppContext();
    const provider = useProvider();
    const [providerData, updateProviderData] = useProviderData();

    const providerContext = {
        data: providerData?.data ?? {},
        updateData: (updater: (draft: unknown) => void) => {
            updateProviderData(draft => updater(draft.data));
        },
        cache: ctx.cache.providers[provider.id] ?? {},
        updateCache: (updater: (draft: unknown) => void) => {
            ctx.updateCache(draft => {
                draft.providers[provider.id] ??= {};
                updater(draft.providers[provider.id]);
            });
        },
        currentUrl: ctx.workspace.app.currentUrl,
        setCurrentUrl: (url: string) => {
            ctx.updateWorkspace(draft => {
                draft.app.currentUrl = url;
            });
        },
    };

    const providerOutput = provider.render(providerContext);
    const providerActionNodes =
        providerOutput.actions?.map(action => (
            action.type === "node" ? action.render() : undefined
        )) ?? [];
    return provider &&
        <div className="flex flex-col gap-2 mb-2">
            {...providerActionNodes}
            {provider.enableItemGrouping ? <>
                <ExplorerGroup
                    variant="ungrouped"
                    providerOutput={providerOutput} />
                {providerData?.groupOrder
                    .filter(groupName => groupName in providerData.groups)
                    .map(groupName => (
                        <ExplorerGroup
                            key={groupName}
                            variant="default"
                            groupName={groupName}
                            providerOutput={providerOutput} />
                    ))}
                <ExplorerCreateGroupComponent />
            </> :
                Object
                    .entries(providerOutput.items)
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
        </div>;
}

function ExplorerGroup(props: ReadonlyDeep<{
    providerOutput: ReadonlyDeep<{ items: Record<string, Item>}>,
} & (
    | { variant: "default", groupName: string }
    | { variant: "ungrouped" })>) {
    function renderItem([itemId, item]: ReadonlyDeep<[string, Item]>) {
        return (
            <ExplorerItem
                key={itemId}
                item={item}
                itemGroupName={props.variant === "default" ? props.groupName : ""} />
        );
    }

    const [providerData, __] = useProviderData();
    return props.variant === "ungrouped"
        ? <>
            <ExplorerGroupHeader variant="ungrouped"/>
            {_.pipe(
                _.entries(props.providerOutput.items),
                _.filter(([itemId, __]) => (
                    !Object
                        .entries(providerData.groups)
                        .some(([_, group]) => group.items.includes(itemId)))),
                _.sortBy(([_, item]) => item.sortKey),
                _.map(renderItem))}
        </>
        : <>
            <ExplorerGroupHeader variant="default" groupName={props.groupName} />
            {providerData.expandedGroups.includes(props.groupName) &&
                _.pipe(
                    _.entries(props.providerOutput.items),
                    _.filter(([itemId, __]) => (
                        providerData
                            .groups[props.groupName]?.items
                            .includes(itemId)
                        ?? false)),
                    _.sortBy(([_, item]) => item.sortKey),
                    _.map(renderItem))}
        </>;
}
