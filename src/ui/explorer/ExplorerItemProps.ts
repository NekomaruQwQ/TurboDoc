export default interface ExplorerItemProps<T> {
    item: T;
    expanded: boolean;
    setExpanded(expanded: boolean): void;
    updateItem(updater: (item: T) => void): void;
    removeItem(): void;
}
