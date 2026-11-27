/**
 * The `BrandPanel` extension on the web (lane PA1): today's auth panel (`page/auth/layout.ts`,
 * `onboarding/brand-panel.ts`) drawn into the `hz:ext` placeholder in `screen`'s `aside`. The
 * picture follows the local season and time of day, read when the panel is drawn.
 * Registered on import: `primitives.ts` loads every file in this folder.
 */
import { BrandPanel } from "../../../extensions/BrandPanel.ts"
import { registerWebExtension } from "../../extensions.ts"
import { part } from "../define.ts"
import { ensureSheet } from "../list/runtime.ts"

/** `getOnboardingImage`: season by month, day from 6AM to 6PM, in local time. */
export const pictureAt = (now: Date): string => {
	const month = now.getMonth()
	const hour = now.getHours()
	const season =
		month >= 2 && month <= 4
			? "spring"
			: month >= 5 && month <= 7
				? "summer"
				: month >= 8 && month <= 10
					? "autumn"
					: "winter"
	return `${season}-${hour >= 6 && hour < 18 ? "day" : "night"}.webp`
}

// The Hazel mark (`web-foldkit/src/icons` `Logo`), the panel's own drawing.
const LOGO = `<svg viewBox="0 0 266 219" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M155 124.5C167.167 122 187.955 109.3 194.355 96.5H194.351C186.184 82.1666 159.851 55 119.851 61C117.851 55.8333 111.351 43.4 101.351 35C89.3534 43 36.8548 167.5 93.3539 219C65.3542 210.167 7.65476 178.6 0.854757 123C-7.64524 53.5 48.8583 8.5 98.8548 8.5C113.448 8.5 132.429 10.7577 151.994 13.0847C199.458 18.7303 250.355 24.7841 250.355 0C270.189 29 289 137.5 172.5 183.5C172.846 182.02 173.227 180.493 173.618 178.927C177.936 161.629 183.427 139.631 155 124.5ZM146 88.5C146 93.1944 142.194 97 137.5 97C132.806 97 129 93.1944 129 88.5C129 83.8056 132.806 80 137.5 80C142.194 80 146 83.8056 146 88.5ZM120.788 136.708C92.0055 138.35 87.7744 156.553 89.2567 165.449C89.2567 169.308 95.9604 172.519 102.089 175.454C107.696 178.138 112.822 180.593 111.895 183.104C109.955 188.359 100.576 188.578 96.1295 188.031C99.9025 198.706 111.006 219.399 125.235 216.772C139.464 214.144 150.029 196.516 153.532 188.031C149.49 188.852 137.767 186.388 137.767 181.461C137.767 179.718 140.551 178.54 144.149 177.018C150.718 174.238 160 170.312 160 159.701C159.03 139.993 136.958 135.339 126.044 135.476C128.307 127.593 134.802 124.254 137.767 123.569C136.796 118.971 132.781 117.274 130.894 117C123.456 122.584 121.057 132.465 120.788 136.708Z"/></svg>`

const ROOT = '[data-hz="ext"][data-ext="BrandPanel"]'
// HAZEL-GAP(p4-brand-panel-ink): the panel lies on a fixed picture in both themes, so its ink is
// the picture's (white, a black glass card, an 18/28 line) and no theme token holds it.
const css = `
${ROOT} { margin: 0; flex: 1 1 auto; display: flex; flex-direction: column; }
${ROOT} > [data-hz-part="surface"] { flex: 1 1 auto; display: flex; flex-direction: column; }
${ROOT} [data-hz-part="panel"] {
	position: relative; flex: 1 1 auto; display: flex; flex-direction: column; padding: var(--hz-space-10); color: #fff;
}
${ROOT} [data-hz-part="picture"] {
	position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: left top;
	image-rendering: pixelated;
}
${ROOT} [data-hz-part="home"] {
	position: relative; z-index: 20; display: flex; align-items: center; gap: var(--hz-space-2);
	color: inherit; text-decoration: none; align-self: flex-start;
}
${ROOT} [data-hz-part="home"] > svg { width: var(--hz-space-8); height: var(--hz-space-8); color: #fff; }
${ROOT} [data-hz-part="home"] > strong { font-weight: var(--hz-weight-semibold); }
${ROOT} [data-hz-part="home"]:focus-visible { outline: 2px solid var(--hz-color-ring); outline-offset: 2px; }
${ROOT} [data-hz-part="card"] {
	position: relative; z-index: 20; margin-top: auto; border-radius: var(--hz-radius-xl);
	background: rgb(0 0 0 / 0.6); padding: var(--hz-space-6); box-shadow: 0 0 0 1px rgb(255 255 255 / 0.1);
	backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
${ROOT} [data-hz-part="card"][hidden] { display: none; }
${ROOT} [data-hz-part="tagline"] { margin: 0; font-size: 18px; line-height: 28px; color: #fff; }
`

registerWebExtension(BrandPanel, (container, props) => {
	const document = container.ownerDocument
	ensureSheet(document, "brandPanel", css)
	const panel = part(document, "div", "panel")
	const picture = part(document, "img", "picture") as HTMLImageElement
	picture.alt = "Background"
	const home = part(document, "a", "home") as HTMLAnchorElement
	home.innerHTML = LOGO
	const wordmark = document.createElement("strong")
	wordmark.textContent = "Hazel"
	home.append(wordmark)
	const card = part(document, "div", "card")
	const tagline = part(document, "p", "tagline")
	card.append(tagline)
	panel.append(picture, home, card)
	container.append(panel)
	const apply = (next: typeof props) => {
		picture.src = `${next.pictures}/${pictureAt(new Date())}`
		home.href = next.homeHref
		tagline.textContent = next.tagline ?? ""
		card.hidden = next.tagline === null
	}
	apply(props)
	return { update: apply, dispose: () => panel.remove() }
})
