import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import type { Item } from "@/core/data";
import providers from "@/providers";
import {
    ProviderProvider,
    useAppContext,
    useProvider,
    useProviderData,
} from "@/core/context";

import ExplorerItem from "@/ui/explorer/ExplorerItem";
import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader";
import ExplorerCreateGroupComponent from "@/ui/explorer/ExplorerCreateGroupComponent";

export default function Explorer() {
    const ctx = useAppContext();
    const app = ctx.workspace.app;
    const preset = app.presets[app.currentPreset];
    return (
        <div className="w-full h-full px-2">
            <div
                className="flex flex-col w-full h-full gap-1 py-1 rounded overflow-y-scroll"
                style={{ scrollbarWidth: "none" }}>
                {preset?.providers
                    .map(providerId => providers[providerId])
                    .map(provider => provider && (
                        <ProviderProvider key={provider.id} value={provider}>
                            <ExplorerProvider />
                        </ProviderProvider>
                    ))}
            </div>
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
        providerOutput.actions?.map(action => {
            if (action.type === "node") {
                return action.render();
            }
        }) ?? [];
    return provider && (
        provider.enableItemGrouping ?
            <div className="flex flex-col gap-3">
                {...providerActionNodes}
                <ExplorerGroup
                    variant="ungrouped"
                    providerOutput={providerOutput} />
                {Object
                    .keys(providerData?.groups ?? {})
                    .map(groupName => (
                        <ExplorerGroup
                            key={groupName}
                            variant="default"
                            groupName={groupName}
                            providerOutput={providerOutput} />
                    ))}
                <ExplorerCreateGroupComponent />
            </div> :
            <div className="flex flex-col gap-2">
                {...providerActionNodes}
                {Object
                    .entries(providerOutput.items)
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
            </div>);
}

function ExplorerGroup(props: ReadonlyDeep<{
    providerOutput: ReadonlyDeep<{ items: Record<string, Item>}>,
} & (
    | { variant: "default", groupName: string }
    | { variant: "ungrouped" })>) {
    const [providerData, __] = useProviderData();
    return props.variant === "ungrouped"
        ? <div className="flex flex-col gap-1.5">
            <ExplorerGroupHeader variant="ungrouped"/>
            <div className="flex flex-col gap-2">
                {Object
                    .entries(props.providerOutput.items)
                    .filter(([itemId, __]) => (
                        !Object
                            .entries(providerData.groups)
                            .some(([_, group]) => group.items.includes(itemId))))
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
            </div>
        </div>
        : <div className="flex flex-col gap-1.5">
            <ExplorerGroupHeader variant="default" groupName={props.groupName} />
            {providerData.expandedGroups.includes(props.groupName) &&
                <div className="flex flex-col gap-2">
                    {_
                        .entries(props.providerOutput.items)
                        .filter(([itemId, __]) => (
                            providerData.groups[props.groupName]?.items.includes(itemId)))
                        .map(([itemId, item]) => (
                            <ExplorerItem
                                key={itemId}
                                item={item}
                                itemGroupName="" />))}
                </div>}
        </div>;
}
