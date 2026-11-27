// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The `HtmlRender` extension on the web (lane PC6): a bot's page in a sandboxed frame. It lives with
 * the app, not in `@hazel/ui`, because it speaks the domain's frame protocol
 * (`@hazel/domain/html-render`). `allow-scripts` without `allow-same-origin` keeps the page in an
 * opaque origin, away from the app's cookies and API.
 */
import {
	clampHtmlRenderHeight,
	htmlRenderFitHeight,
	htmlRenderThemeMessage,
	isHtmlRenderInlineRequest,
	isHtmlRenderPointerLeft,
	readHtmlRenderContentHeight,
	readHtmlRenderLinkRequest,
} from "@hazel/domain/html-render"
import { HtmlRender } from "@hazel/ui/extensions/HtmlRender"
import { registerWebExtension } from "@hazel/ui/web/extensions"
import { htmlRenderDialogStyles, htmlRenderStyles } from "~/components/embeds/html-render.styles"
import {
	frameSrc,
	HTML_RENDER_INLINE_MAX_HEIGHT,
	markPointerOutside,
	readDocumentTheme,
	takeLinkSlot,
} from "./html-render"

type Props = typeof HtmlRender.props.Type

const styles = htmlRenderStyles()
const dialogStyles = htmlRenderDialogStyles()

/** The message row's content column starts this far in (avatar, gap, row padding). */
const CONTENT_INSET = "2.625rem"

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
	const node = document.createElement(tag)
	node.className = className
	return node
}

const control = (label: string, onPress: () => void) => {
	const button = element("button", styles.control())
	button.type = "button"
	button.textContent = label
	button.addEventListener("click", onPress)
	return button
}

registerWebExtension(HtmlRender, (container, initial, send) => {
	let props: Props = initial
	const fullscreen = initial.mode === "fullscreen"
	const root = element("div", fullscreen ? dialogStyles.body() : styles.root())
	if (fullscreen) root.style.height = "75dvh"
	else root.style.marginLeft = `calc(${CONTENT_INSET} - 0.5rem)`
	const viewport = element("div", fullscreen ? "relative size-full" : styles.viewport())
	const status = element("div", "")
	const controls = element("div", styles.controls())
	root.append(viewport, controls)
	container.replaceChildren(root)

	let frame: HTMLIFrameElement | null = null
	let contentHeight: number | null = null
	let isLoaded = false
	let isExpanded = false

	const heights = () => {
		const fitted =
			contentHeight === null ? clampHtmlRenderHeight(props.height) : htmlRenderFitHeight(contentHeight)
		const isTall = fitted > HTML_RENDER_INLINE_MAX_HEIGHT
		return { fitted, isTall, shown: isTall && !isExpanded ? HTML_RENDER_INLINE_MAX_HEIGHT : fitted }
	}

	const postTheme = () =>
		frame?.contentWindow?.postMessage(htmlRenderThemeMessage(readDocumentTheme()), "*")

	const draw = () => {
		const { fitted, isTall, shown } = heights()
		if (!fullscreen) {
			viewport.style.height = `${shown}px`
			viewport.className =
				styles.viewport() + (isTall && !isExpanded ? " mask-b-from-[calc(100%-4rem)]" : "")
		}
		if (frame !== null) {
			frame.className = fullscreen ? dialogStyles.frame() : htmlRenderStyles({ isLoaded }).frame()
			if (!fullscreen) frame.style.height = `${fitted}px`
			frame.style.colorScheme = isLoaded ? readDocumentTheme().appearance : ""
			if (fullscreen && !isLoaded) frame.style.visibility = "hidden"
			else frame.style.visibility = ""
		}
		status.className = props.failed
			? fullscreen
				? dialogStyles.status()
				: styles.error()
			: isLoaded
				? "hidden"
				: fullscreen
					? dialogStyles.status()
					: styles.skeleton()
		status.textContent = props.failed
			? `Unable to load ${props.title}`
			: fullscreen && !isLoaded
				? "Loading…"
				: ""
		if (!isLoaded && !props.failed) status.setAttribute("aria-hidden", "true")
		else status.removeAttribute("aria-hidden")
		controls.replaceChildren(
			...(fullscreen || props.src === null || props.failed
				? []
				: [
						...(isTall
							? [
									control(isExpanded ? "Show less" : "Show more", () => {
										isExpanded = !isExpanded
										draw()
									}),
								]
							: []),
						control("Full screen", () => send("fullscreen", {})),
					]),
		)
	}

	const mount = () => {
		// A frame keeps the page it loaded: a fresh URL for the same render never reloads it.
		if (frame !== null || props.src === null || props.failed) return
		frame = document.createElement("iframe")
		frame.setAttribute("sandbox", "allow-scripts")
		frame.setAttribute("referrerpolicy", "no-referrer")
		frame.setAttribute("loading", fullscreen ? "eager" : "lazy")
		frame.title = props.title
		frame.src = frameSrc(props.src, readDocumentTheme(), fullscreen ? "fullscreen" : "inline")
		frame.addEventListener("load", () => {
			postTheme()
			isLoaded = true
			draw()
		})
		viewport.prepend(frame)
	}

	const onMessage = (event: MessageEvent) => {
		if (frame === null || event.source !== frame.contentWindow) return
		const height = readHtmlRenderContentHeight(event.data)
		if (height !== undefined) {
			// The page reports once it is parsed and themed: it shows from then on.
			contentHeight = height
			isLoaded = true
			return draw()
		}
		if (isHtmlRenderPointerLeft(event.data)) return markPointerOutside()
		if (isHtmlRenderInlineRequest(event.data)) {
			if (fullscreen) send("leaveFullscreen", {})
			return
		}
		const url = readHtmlRenderLinkRequest(event.data)
		const isReader = document.activeElement === frame && (navigator.userActivation?.isActive ?? false)
		if (url !== undefined && isReader && takeLinkSlot()) send("openLink", { url })
	}
	window.addEventListener("message", onMessage)

	// The app's theme can change under the page (mode, brand, gray, radius).
	const observer = new MutationObserver(postTheme)
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })

	viewport.append(status)
	mount()
	draw()
	return {
		update: (next) => {
			props = next
			mount()
			draw()
		},
		dispose: () => {
			window.removeEventListener("message", onMessage)
			observer.disconnect()
		},
	}
})
