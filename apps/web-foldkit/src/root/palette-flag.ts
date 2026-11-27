/** Temporary, while both palettes exist: the parity runner compares them. */
/** The parity flag: `"0"` draws today's Foldkit palette instead (`compare-pages.ts`). */
export const PALETTE_FLAG = "hazel:native:CommandPalette"

export const isNativePalette = (): boolean =>
	typeof localStorage === "undefined" || localStorage.getItem(PALETTE_FLAG) !== "0"
