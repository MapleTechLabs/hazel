/**
 * The `data-hz` styles an island needs, installed once into the app's head: the web host's stand-in
 * CSS (`@hazel/ui/web/styles`), plus its variables keyed on the app's theme class.
 */
import { installStyles } from "@hazel/ui/web/styles"

/**
 * The stand-in CSS picks light or dark from the OS; the app picks from its own setting (`theme.ts`
 * sets `light` or `dark` on <html>). Same values, keyed on the class, so the island follows the app.
 */
const themeCss = `
:root.light {
	--hz-bg: #fafafa; --hz-band: #09090b12; --hz-wash: #00000009;
	--hz-label: #424245; --hz-label-strong: #09090b; --hz-icon: #68686a; --hz-section: #52525c;
	--hz-selected-bg: #9e77ed26; --hz-selected-fg: #6941c6; --hz-muted: #71717a;
}
:root.dark {
	--hz-bg: #111114; --hz-band: #ffffff12; --hz-wash: #ffffff0b;
	--hz-label: #b2b2b3; --hz-label-strong: #fafafa; --hz-icon: #8a8a8c; --hz-section: #9f9fa9;
	--hz-selected-bg: #9e77ed33; --hz-selected-fg: #d6bbfb; --hz-muted: #a1a1aa;
}
`

export const installIslandStyles = (document: Document) => {
	if (document.head.querySelector("style[data-hz-styles]") !== null) return
	installStyles(document)
	const style = document.createElement("style")
	style.dataset.hzIslandTheme = ""
	style.textContent = themeCss
	document.head.append(style)
}
