import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// Warnings we suppress globally:
//   - a11y_click_events_have_key_events / a11y_no_static_element_interactions /
//     a11y_no_noninteractive_element_interactions: TurboDoc's sidebar uses
//     <p>/<div>/<span> as click targets to keep typography intact (matching
//     biome.json's project-wide policy of disabling these rules). We accept
//     the a11y trade-off — the app is a desktop documentation viewer, not a
//     general-purpose web app.
//   - state_referenced_locally: ExplorerProvider reads its `provider` prop
//     once at init. The host iterates with stable keys, so the prop is
//     genuinely immutable per ExplorerProvider lifetime.
const SUPPRESSED = new Set([
    "a11y_click_events_have_key_events",
    "a11y_no_static_element_interactions",
    "a11y_no_noninteractive_element_interactions",
    "state_referenced_locally",
]);

export default {
    preprocess: vitePreprocess(),
    compilerOptions: {
        warningFilter: (warning: { code: string }) => !SUPPRESSED.has(warning.code),
    },
}
