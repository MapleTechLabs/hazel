/**
 * The web's G1 stand-in icon paths. Lane A1 replaces them with the web's own icons
 * (`vocabulary/options.ts` `iconSources`, from `apps/web-foldkit/src/icons`).
 */
const icons: Record<string, string> = {
	hashtag: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
	lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
}

export const svg = (name: string) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? ""}</svg>`
