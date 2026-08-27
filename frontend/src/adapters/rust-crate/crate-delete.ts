import type { RustCrateSourceContext } from "./index";
import { crateNamesEquivalent } from "./crate-name";
import { parseUrl } from "./url";

/** Safe landing page after removing the documentation currently on screen.
 * The docs.rs root is the safe source home and cannot auto-import a crate. */
export const RUST_CRATE_HOME_URL = "https://docs.rs/";

/** Delete one persisted crate, navigating away first when its documentation
 * is currently visible. Crate aliases compare with crates.io semantics so a
 * canonical docs.rs redirect cannot leave a deleted alias in the iframe. */
export function deleteCrate(
    ctx: RustCrateSourceContext,
    crateName: string): void {
    const currentCrateName = parseUrl(ctx.currentUrl)?.name;
    if (currentCrateName && crateNamesEquivalent(currentCrateName, crateName)) {
        ctx.navigateTo(RUST_CRATE_HOME_URL);
    }
    delete ctx.data.crates[crateName];
}
