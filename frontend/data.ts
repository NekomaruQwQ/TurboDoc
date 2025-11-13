export type Item =
	| { type: "crate", data: ItemCrate };

export interface Group {
	name: string;
	is_expanded: boolean;
	items: Item[];
}

export interface ItemCrate {
	/** Name of the crate. */
	name: string;
	/** Whether the crate item is expanded in the UI. */
	is_expanded: boolean;
	/**
	 * All available versions of the crate.
	 *
	 * Note that `latest` is not included here.
	 */
	versions: string[];
	/**
	 * Currently selected version of the crate.
	 *
	 * `latest` means the latest version.
	 */
	current_version: string;
	/**
	 * Pages from `docs.rs` for this crate.
	 *
	 * The full URL can be constructed using [`Self::link_docs`].
	 */
	docs_pages: string[];
	/**
	 * Currently opened page from `docs.rs` for this crate.
	 *
	 * The full URL can be constructed using [`Self::link_docs`].
	 */
	docs_open_page?: string;
}

export interface Workspace {
	groups: Group[];
}
