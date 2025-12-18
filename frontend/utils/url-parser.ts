export interface ParsedDocsUrl {
	crate: string;
	version: string;
	page: string;
}

export function parseDocsRsUrl(url: string): ParsedDocsUrl | null {
	try {
		const parsed = new URL(url);

		// Only handle docs.rs URLs
		if (parsed.hostname !== 'docs.rs') {
			return null;
		}

		// Pattern: /crate/version/path/to/page.html
		const pathMatch = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+)\/(.+)$/);
		if (!pathMatch) {
			return null;
		}

		const [, crate, version, page] = pathMatch;

		return {
			crate,
			version,
			page,
		};
	} catch {
		return null;
	}
}

/**
 * Helper to construct docs.rs URL.
 */
export function buildDocsRsUrl(crate: string, version: string, page?: string): string {
	const base = `https://docs.rs/${crate}/${version}`;
	if (page) {
		return `${base}/${page}`;
	}
	// Default to crate root page
	return `${base}/${crate}`;
}
