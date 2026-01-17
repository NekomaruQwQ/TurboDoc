import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import type { Item, ProviderData } from "@/core/data";
import providers from "@/providers";
import {
    ProviderIdProvider,
    useAppContext,
    useProviderId,
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
                {preset?.providers.map(providerId => (
                    <ProviderIdProvider key={providerId} value={providerId}>
                        <ExplorerProvider />
                    </ProviderIdProvider>
                ))}
            </div>
        </div>);
}

function ExplorerProvider() {
    const ctx = useAppContext();
    const providerId = useProviderId();
    const provider = providers.find(provider => provider.id === providerId);
    if (!provider) {
        return;
    }

    const providerData = ctx.workspace.providers[providerId];

    function updateProviderData(updater: (draft: ProviderData) => void): void {
        ctx.updateWorkspace(draft => {
            const providerData = draft.providers[providerId];
            if (providerData) {
                updater(providerData);
            } else {
                throw new Error(`Unexpected provider id: ${providerId}`);
            }
        });
    }

    const providerContext = {
        data: providerData?.data ?? {},
        updateData: (updater: (draft: unknown) => void) => {
            updateProviderData(draft => updater(draft.data));
        },
        cache: ctx.cache.providers[providerId] ?? {},
        updateCache: (updater: (draft: unknown) => void) => {
            ctx.updateCache(draft => {
                draft.providers[providerId] ??= {};
                updater(draft.providers[providerId]);
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
    return provider && (
        provider.enableItemGrouping ? <>
            <ExplorerCreateGroupComponent />
            <ExplorerGroup
                variant="ungrouped"
                providerOutput={providerOutput} />
            {_
                .keys(providerData?.groups ?? {})
                .map(groupName => (
                    <ExplorerGroup
                        key={groupName}
                        variant="default"
                        groupName={groupName}
                        providerOutput={providerOutput} />
                ))}
        </> : <>
            <div className="flex flex-col gap-2">
                {_
                    .entries(providerOutput.items)
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
            </div>
        </>);
}

function ExplorerGroup(props: ReadonlyDeep<{
    providerOutput: ReadonlyDeep<{ items: Record<string, Item>}>,
} & (
    | { variant: "default", groupName: string }
    | { variant: "ungrouped" })>) {
    const [providerData, updateProviderData] = useProviderData();
    return props.variant === "ungrouped"
        ? <div className="flex flex-col gap-1">
            <ExplorerGroupHeader variant="ungrouped"/>
            <div className="flex flex-col gap-2">
                {_
                    .entries(props.providerOutput.items)
                    .filter(([itemId, __]) => (
                        !_.entries(providerData.groups)
                            .some(([_, group]) => group.items.includes(itemId))))
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
            </div>
        </div>
        : <div className="flex flex-col gap-1">
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
