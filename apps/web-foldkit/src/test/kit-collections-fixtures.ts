/**
 * jsdom ships no `CSS.escape`, but the collection views build focus selectors with it while
 * handling keydown. Installs a minimal escape once per test file.
 */
export const installCssEscape = (): void => {
	if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
		Object.defineProperty(globalThis, "CSS", {
			configurable: true,
			value: { escape: (value: string) => value.replace(/([^\w-])/g, "\\$1") },
		})
	}
}
