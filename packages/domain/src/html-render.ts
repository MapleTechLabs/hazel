/**
 * HTML renders: a self-contained HTML page a bot publishes (`POST /api/v1/html-renders`) and a
 * message embed shows (`MessageEmbed.html`). Adapted from T3 Code's `html_render`.
 *
 * Isolation: the page is served with a `sandbox` CSP (`HTML_RENDER_CONTENT_SECURITY_POLICY`) and
 * framed with `sandbox="allow-scripts"` and never `allow-same-origin`, so it runs in an opaque
 * origin with no access to Hazel's cookies, storage or API. It may load assets over https, but
 * cannot fetch, open sockets or submit forms (`connect-src 'none'`, `form-action 'none'`). Asset
 * requests can still tell a server that the page was viewed; the page holds only its own content.
 *
 * The page and the app talk JSON-RPC over `postMessage`, with MCP Apps method names: the page
 * reports its height (`ui/notifications/size-changed`) and asks the app to open links
 * (`ui/open-link`); the app pushes its theme (`ui/notifications/host-context-changed`). The
 * bootstrap the server injects (`injectHtmlRenderBootstrap`) is the page's side.
 */

export const HTML_RENDER_MAX_BYTES = 512_000
export const HTML_RENDER_MIN_HEIGHT = 80
export const HTML_RENDER_MAX_HEIGHT = 2000
export const HTML_RENDER_MAX_TITLE_LENGTH = 200
/** A client fits the frame to the live page, up to this height. */
export const HTML_RENDER_MAX_FIT_HEIGHT = 20_000

/** Served with every page. The frame's own `sandbox` attribute can only narrow it. */
export const HTML_RENDER_CONTENT_SECURITY_POLICY = [
	"sandbox allow-scripts",
	"default-src 'none'",
	"script-src 'unsafe-inline' 'unsafe-eval' https:",
	"style-src 'unsafe-inline' https:",
	"img-src data: blob: https:",
	"media-src data: blob: https:",
	"font-src data: https:",
	"connect-src 'none'",
	"form-action 'none'",
	"frame-src 'none'",
	"base-uri 'none'",
].join("; ")

export const clampHtmlRenderHeight = (height: number): number =>
	Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.round(height)))

/** The frame's height once the page reported `contentHeight`. */
export const htmlRenderFitHeight = (contentHeight: number): number =>
	Math.min(HTML_RENDER_MAX_FIT_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.ceil(contentHeight)))

// ============ Theme ============

export type HtmlRenderAppearance = "light" | "dark"

/** The CSS variables a page can use; the app sets each from its own tokens. */
export const HTML_RENDER_THEME_VARIABLES = [
	"--background",
	"--foreground",
	"--muted",
	"--muted-foreground",
	"--card",
	"--card-foreground",
	"--border",
	"--ring",
	"--primary",
	"--primary-foreground",
	"--secondary",
	"--secondary-foreground",
	"--accent",
	"--accent-foreground",
	"--destructive",
	"--destructive-foreground",
	"--warning",
	"--warning-foreground",
	"--success",
	"--success-foreground",
	"--code-background",
	"--code-foreground",
	"--chart-1",
	"--chart-2",
	"--chart-3",
	"--chart-4",
	"--chart-5",
	"--radius",
	"--font-sans",
	"--font-mono",
] as const

export type HtmlRenderThemeVariable = (typeof HTML_RENDER_THEME_VARIABLES)[number]

export interface HtmlRenderTheme {
	readonly appearance: HtmlRenderAppearance
	readonly variables: Readonly<Partial<Record<HtmlRenderThemeVariable, string>>>
}

const FONT_SANS = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
const FONT_MONO = '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'

/** Used until the app's theme arrives, and when the page is opened on its own. */
export const HTML_RENDER_DEFAULT_THEMES: Record<HtmlRenderAppearance, HtmlRenderTheme> = {
	light: {
		appearance: "light",
		variables: {
			"--background": "#ffffff",
			"--foreground": "#181d27",
			"--muted": "#f5f5f5",
			"--muted-foreground": "#535862",
			"--card": "#fafafa",
			"--card-foreground": "#181d27",
			"--border": "#e9eaeb",
			"--ring": "#6938ef",
			"--primary": "#6938ef",
			"--primary-foreground": "#ffffff",
			"--secondary": "#f5f5f5",
			"--secondary-foreground": "#252b37",
			"--accent": "#6938ef",
			"--accent-foreground": "#ffffff",
			"--destructive": "#d92d20",
			"--destructive-foreground": "#ffffff",
			"--warning": "#dc6803",
			"--warning-foreground": "#ffffff",
			"--success": "#079455",
			"--success-foreground": "#ffffff",
			"--code-background": "#f5f5f5",
			"--code-foreground": "#252b37",
			"--chart-1": "#6938ef",
			"--chart-2": "#0d9488",
			"--chart-3": "#d97706",
			"--chart-4": "#e11d48",
			"--chart-5": "#65a30d",
			"--radius": "0.5rem",
			"--font-sans": FONT_SANS,
			"--font-mono": FONT_MONO,
		},
	},
	dark: {
		appearance: "dark",
		variables: {
			"--background": "#0c0e12",
			"--foreground": "#f7f7f7",
			"--muted": "#22262f",
			"--muted-foreground": "#94979c",
			"--card": "#13161b",
			"--card-foreground": "#f7f7f7",
			"--border": "#22262f",
			"--ring": "#9b8afb",
			"--primary": "#7a5af8",
			"--primary-foreground": "#ffffff",
			"--secondary": "#22262f",
			"--secondary-foreground": "#cecfd2",
			"--accent": "#9b8afb",
			"--accent-foreground": "#ffffff",
			"--destructive": "#f04438",
			"--destructive-foreground": "#ffffff",
			"--warning": "#f79009",
			"--warning-foreground": "#0c0e12",
			"--success": "#17b26a",
			"--success-foreground": "#0c0e12",
			"--code-background": "#13161b",
			"--code-foreground": "#cecfd2",
			"--chart-1": "#9b8afb",
			"--chart-2": "#2dd4bf",
			"--chart-3": "#fbbf24",
			"--chart-4": "#fb7185",
			"--chart-5": "#a3e635",
			"--radius": "0.5rem",
			"--font-sans": FONT_SANS,
			"--font-mono": FONT_MONO,
		},
	},
}

/** Theme and layout rules for page authors (bot SDK docs, API description). */
export const HTML_RENDER_AUTHOR_GUIDE = [
	"Send one self-contained HTML document: inline <style> and <script>; https assets load, but the page cannot fetch, open sockets or submit forms.",
	"Use the theme CSS variables on :root instead of fixed colors: --background, --foreground, --muted, --card, --border, --ring, --primary, --secondary, --accent, --destructive, --warning, --success (most have a -foreground), --code-background, --chart-1 to --chart-5, --radius, --font-sans, --font-mono.",
	"The frame is the message column's width and sits on the channel background: leave html and body without a background, outer card or side padding, and use fluid widths.",
	"Let content set the height: vh units are rejected, and height:100% on html or body loops.",
].join(" ")

// ============ Bridge (JSON-RPC over postMessage) ============

const HOST_CONTEXT_CHANGED_METHOD = "ui/notifications/host-context-changed"
const SIZE_CHANGED_METHOD = "ui/notifications/size-changed"
const OPEN_LINK_METHOD = "ui/open-link"
const THEME_FRAGMENT_KEY = "hazel-theme"

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null

/** The page's height, from a `size-changed` notification. */
export const readHtmlRenderContentHeight = (data: unknown): number | undefined => {
	if (!isRecord(data) || data.jsonrpc !== "2.0" || data.method !== SIZE_CHANGED_METHOD) return undefined
	const height = isRecord(data.params) ? data.params.height : undefined
	return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined
}

/** An http(s) link the page asks the app to open. */
export const readHtmlRenderLinkRequest = (data: unknown): string | undefined => {
	if (!isRecord(data) || data.jsonrpc !== "2.0" || data.method !== OPEN_LINK_METHOD) return undefined
	const url = isRecord(data.params) ? data.params.url : undefined
	return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined
}

export const htmlRenderThemeMessage = (theme: HtmlRenderTheme) =>
	({
		jsonrpc: "2.0",
		method: HOST_CONTEXT_CHANGED_METHOD,
		params: { theme: theme.appearance, styles: { variables: theme.variables } },
	}) as const

/** Append to the page's URL: the bootstrap applies the theme before first paint. */
export const htmlRenderThemeFragment = (theme: HtmlRenderTheme): string =>
	`#${THEME_FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify(theme))}`

// ============ Bootstrap (the page's side) ============

const BASE_CSS =
	"html{box-sizing:border-box;padding:8px;background:transparent;color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}" +
	"html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
	":where(:focus-visible){outline:2px solid var(--ring);outline-offset:-2px}"

const rootRule = (theme: HtmlRenderTheme): string =>
	`:root{color-scheme:${theme.appearance};${Object.entries(theme.variables)
		.map(([name, value]) => `${name}:${value};`)
		.join("")}}`

// Applies the theme from the URL fragment before paint and from the app's notifications after;
// hands link clicks to the app; reports the content height whenever it changes.
const BOOTSTRAP_SCRIPT = `(function(){var s=document.getElementById("hazel-theme"),n=0,P=window.parent!==window;if(!s)return;var b=${JSON.stringify(BASE_CSS)};function a(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;var c=":root{color-scheme:"+(t.appearance==="light"?"light":"dark")+";";for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}s.textContent=c+"}"+b;}try{var m=/[#&]${THEME_FRAGMENT_KEY}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(e.source===window.parent&&d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED_METHOD)}&&p&&p.styles)a({appearance:p.theme,variables:p.styles.variables});});document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;if(!P)return;e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",id:"hazel-link-"+(++n),method:${JSON.stringify(OPEN_LINK_METHOD)},params:{url:u.href}},"*");},true);if(P){var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED_METHOD)},params:{height:v}},"*");};if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);}})();`

const bootstrapMarkup = (markup: string): string => {
	const defaultCss = `${rootRule(HTML_RENDER_DEFAULT_THEMES.dark)}@media (prefers-color-scheme: light){${rootRule(HTML_RENDER_DEFAULT_THEMES.light)}}${BASE_CSS}`
	return [
		/<meta\s[^>]*charset/i.test(markup.slice(0, 4096)) ? "" : '<meta charset="utf-8">',
		/<meta\s[^>]*name\s*=\s*["']?viewport/i.test(markup)
			? ""
			: '<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<style id="hazel-theme">${defaultCss}</style>`,
		`<script>${BOOTSTRAP_SCRIPT}</script>`,
	].join("")
}

/** Blank comments and raw-text elements without shifting offsets, so tag scans skip them. */
const blankNonMarkup = (html: string): string => {
	const scan = html.replace(
		/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
		(match) => " ".repeat(match.length),
	)
	const parts: Array<string> = []
	let depth = 0
	let start = 0
	let at = 0
	for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
		if (!match[1]) {
			if (depth++ === 0) start = match.index
		} else if (depth > 0 && --depth === 0) {
			const end = match.index + match[0].length
			parts.push(scan.slice(at, start), " ".repeat(end - start))
			at = end
		}
	}
	if (depth > 0) {
		parts.push(scan.slice(at, start), " ".repeat(scan.length - start))
		at = scan.length
	}
	parts.push(scan.slice(at))
	return parts.join("")
}

/** Put the theme stylesheet and bridge script first in the page's `<head>`. */
export const injectHtmlRenderBootstrap = (html: string): string => {
	const scan = blankNonMarkup(html)
	const markup = bootstrapMarkup(scan)
	const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan)
	if (headOpen) {
		const at = headOpen.index + headOpen[0].length
		return html.slice(0, at) + markup + html.slice(at)
	}
	const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan)
	if (htmlOpen) {
		const at = htmlOpen.index + htmlOpen[0].length
		return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
	}
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
	if (doctype) {
		const at = doctype[0].length
		return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
	}
	return `<!doctype html><head>${markup}</head>${html}`
}

// Stylesheets and style attributes only, even inside scripts; comments are skipped whole.
const CSS_SOURCE =
	/<!--[\s\S]*?(?:-->|$)|<style\b[^>]*(?:>|$)([\s\S]*?)(?:<\/style\s*>|$)|\sstyle\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]+))/gi
// The lookbehind skips base64 runs, such as an inlined image that happens to contain "1vh".
const VIEWPORT_HEIGHT_UNIT = /(?<![\w.+/])(?:\d+(?:\.\d+)?|\.\d+)(?:[sld]?(?:vh|vb|vmin|vmax))(?![\w-])/i

/**
 * The first viewport height unit in the page's CSS. The frame grows to fit the page, so a size
 * that follows the viewport grows it again and again: publishing refuses such pages.
 */
export const findViewportHeightUnit = (html: string): string | undefined => {
	for (const [, sheet, doubleQuoted, singleQuoted, unquoted] of html.matchAll(CSS_SOURCE)) {
		const found = VIEWPORT_HEIGHT_UNIT.exec(sheet ?? doubleQuoted ?? singleQuoted ?? unquoted ?? "")?.[0]
		if (found !== undefined) return found
	}
	return undefined
}
