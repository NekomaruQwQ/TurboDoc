import { useAppContext } from '@/context';
import type { Item, ItemCrate } from '@/data';
import type { ReadonlyDeep } from 'type-fest';

export function Explorer() {
    const ctx = useAppContext();
    const workspace = ctx.workspace;
    return <div className='p-2 space-y-4 w-full h-full'>
        {workspace.ungrouped.length > 0 &&
            <ExplorerGroup
                key=':ungrouped:'
                name='Ungrouped'
                expanded={true}
                items={workspace.ungrouped}/>}
        {workspace.groups.map(group => (
            <ExplorerGroup
                key={group.name}
                name={group.name}
                expanded={group.expanded}
                items={group.items} />
        ))}
    </div>;
}

interface ExplorerGroupProps {
    name: string;
    items: ReadonlyDeep<Item[]>;
    expanded: boolean;
}

function ExplorerGroup(props: ExplorerGroupProps) {
    return <div className='space-y-2'>
        <div>
            <p className='text-muted-foreground text-sm font-semibold uppercase'>{props.name}</p>
        </div>
        {props.items.map(item => {
            switch (item.type) {
                case 'crate':
                    return <ItemCrate key={item.data.name} crate={item.data} />;
                default:
            }
        })}
    </div>;
}

function ItemCrate(props: { crate: ReadonlyDeep<ItemCrate> }) {
    return <div className='px-2 py-1 rounded bg-accent shadow-card'>
        <div>
            <p className='font-mono opacity-90'>{props.crate.name}</p>
        </div>
    </div>;
}
