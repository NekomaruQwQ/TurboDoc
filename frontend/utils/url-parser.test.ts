import { describe, expect, test } from 'bun:test';
import { parseDocsRsUrl, buildDocsRsUrl } from './url-parser';

describe('parseDocsRsUrl', () => {
	test('parses valid docs.rs URL with page path', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio/1.42.0/tokio/task/index.html');
		expect(result).toEqual({
			crate: 'tokio',
			version: '1.42.0',
			page: 'tokio/task/index.html',
		});
	});

	test('parses docs.rs URL with struct page', () => {
		const result = parseDocsRsUrl('https://docs.rs/glam/0.28.0/glam/struct.Vec3.html');
		expect(result).toEqual({
			crate: 'glam',
			version: '0.28.0',
			page: 'glam/struct.Vec3.html',
		});
	});

	test('parses docs.rs URL with "latest" version', () => {
		const result = parseDocsRsUrl('https://docs.rs/serde/latest/serde/index.html');
		expect(result).toEqual({
			crate: 'serde',
			version: 'latest',
			page: 'serde/index.html',
		});
	});

	test('parses docs.rs URL with deeply nested page path', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio/1.42.0/tokio/sync/mpsc/struct.Sender.html');
		expect(result).toEqual({
			crate: 'tokio',
			version: '1.42.0',
			page: 'tokio/sync/mpsc/struct.Sender.html',
		});
	});

	test('parses docs.rs URL with pre-release version', () => {
		const result = parseDocsRsUrl('https://docs.rs/bevy/0.15.0-rc.1/bevy/index.html');
		expect(result).toEqual({
			crate: 'bevy',
			version: '0.15.0-rc.1',
			page: 'bevy/index.html',
		});
	});

	test('returns null for non-docs.rs URL', () => {
		const result = parseDocsRsUrl('https://crates.io/crates/tokio');
		expect(result).toBeNull();
	});

	test('returns null for docs.rs URL without page path', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio/1.42.0');
		expect(result).toBeNull();
	});

	test('returns null for docs.rs URL with only crate name', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio');
		expect(result).toBeNull();
	});

	test('returns null for invalid URL', () => {
		const result = parseDocsRsUrl('not a url');
		expect(result).toBeNull();
	});

	test('returns null for docs.rs root', () => {
		const result = parseDocsRsUrl('https://docs.rs/');
		expect(result).toBeNull();
	});

	test('handles URL with query parameters', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio/1.42.0/tokio/index.html?search=foo');
		expect(result).toEqual({
			crate: 'tokio',
			version: '1.42.0',
			page: 'tokio/index.html',
		});
	});

	test('handles URL with hash fragment', () => {
		const result = parseDocsRsUrl('https://docs.rs/tokio/1.42.0/tokio/index.html#method.spawn');
		expect(result).toEqual({
			crate: 'tokio',
			version: '1.42.0',
			page: 'tokio/index.html',
		});
	});
});

describe('buildDocsRsUrl', () => {
	test('builds URL with crate root page (no page specified)', () => {
		const url = buildDocsRsUrl('tokio', '1.42.0');
		expect(url).toBe('https://docs.rs/tokio/1.42.0/tokio');
	});

	test('builds URL with specific page path', () => {
		const url = buildDocsRsUrl('tokio', '1.42.0', 'tokio/task/index.html');
		expect(url).toBe('https://docs.rs/tokio/1.42.0/tokio/task/index.html');
	});

	test('builds URL with "latest" version', () => {
		const url = buildDocsRsUrl('serde', 'latest', 'serde/index.html');
		expect(url).toBe('https://docs.rs/serde/latest/serde/index.html');
	});

	test('builds URL with pre-release version', () => {
		const url = buildDocsRsUrl('bevy', '0.15.0-rc.1', 'bevy/index.html');
		expect(url).toBe('https://docs.rs/bevy/0.15.0-rc.1/bevy/index.html');
	});

	test('builds URL with deeply nested page', () => {
		const url = buildDocsRsUrl('tokio', '1.42.0', 'tokio/sync/mpsc/struct.Sender.html');
		expect(url).toBe('https://docs.rs/tokio/1.42.0/tokio/sync/mpsc/struct.Sender.html');
	});

	test('builds URL with empty page (should default to crate root)', () => {
		const url = buildDocsRsUrl('glam', '0.28.0', '');
		expect(url).toBe('https://docs.rs/glam/0.28.0/glam');
	});
});

describe('parseDocsRsUrl and buildDocsRsUrl roundtrip', () => {
	test('roundtrip: parse then build returns equivalent URL', () => {
		const original = 'https://docs.rs/tokio/1.42.0/tokio/task/index.html';
		const parsed = parseDocsRsUrl(original);
		expect(parsed).not.toBeNull();

		const rebuilt = buildDocsRsUrl(parsed!.crate, parsed!.version, parsed!.page);
		expect(rebuilt).toBe(original);
	});

	test('roundtrip: build then parse returns same data', () => {
		const crate = 'serde';
		const version = '1.0.0';
		const page = 'serde/de/trait.Deserialize.html';

		const url = buildDocsRsUrl(crate, version, page);
		const parsed = parseDocsRsUrl(url);

		expect(parsed).toEqual({ crate, version, page });
	});
});
