import type { Provider } from "./data";

/** Find the first registered provider that structurally owns a navigation URL.
 *
 * Provider registration order is the explicit tie-breaker for any future
 * overlap. Current providers intentionally have disjoint ownership rules.
 */
export function findProviderForUrl(
    providers: readonly Provider[],
    url: string): Provider | undefined {
    return providers.find(provider => provider.ownsUrl(url));
}
