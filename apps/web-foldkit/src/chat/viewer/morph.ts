/**
 * The image viewer's morph: opening and closing render inside a View Transition (the app's
 * `viewTransition`), and one `view-transition-name` passes between the image on the page (the
 * plate) and the viewer's open slide, so the browser carries the image between the two boxes.
 * The CSS lives in `styles.css` (`data-image-viewer-origin`).
 *
 * The plate is only known to the DOM: the one pressed to open the viewer, then whichever image on
 * the page shows the slide on view, so closing lands on the image that was being looked at.
 */

export const VIEWER_ATTRIBUTE = "data-image-viewer"
const ORIGIN_ATTRIBUTE = "data-image-viewer-origin"

/** Outlasts the closing transition, which still needs the plate's name. */
const RELEASE_AFTER_MS = 600

/** The transition type CSS scopes the morph's timing to (`:active-view-transition-type`). */
export const VIEW_TRANSITION_TYPE = "image-viewer"

const isViewerOpen = () => document.querySelector(`[${VIEWER_ATTRIBUTE}]`) !== null

const clearOrigin = () => {
	for (const marked of document.querySelectorAll(`[${ORIGIN_ATTRIBUTE}]`))
		marked.removeAttribute(ORIGIN_ATTRIBUTE)
}

const setOrigin = (image: HTMLImageElement | null) => {
	if (image?.hasAttribute(ORIGIN_ATTRIBUTE)) return
	clearOrigin()
	image?.setAttribute(ORIGIN_ATTRIBUTE, "")
}

/** A transition snapshots its first frame as is, so the plate's bitmap has to be painted. */
const isPainted = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0

const isInView = (element: Element) => {
	const box = element.getBoundingClientRect()
	return (
		box.width > 0 &&
		box.height > 0 &&
		box.bottom > 0 &&
		box.right > 0 &&
		box.top < window.innerHeight &&
		box.left < window.innerWidth
	)
}

const sourceOf = (image: HTMLImageElement) => image.currentSrc || image.src

const pressedImage = (target: EventTarget | null): HTMLImageElement | null => {
	if (!(target instanceof Element)) return null
	const image = target.closest("img") ?? target.closest("button, a, [role=button]")?.querySelector("img")
	return image instanceof HTMLImageElement ? image : null
}

/**
 * Remembers the image a press lands on while no viewer is open: if the press opens one, it grows
 * out of that image. Installed once, in the capture phase, so it runs before the press's Message.
 */
export const installImageViewerMorph = (): (() => void) => {
	const onClick = (event: MouseEvent) => {
		if (isViewerOpen()) return
		const image = pressedImage(event.target)
		setOrigin(image !== null && isPainted(image) && isInView(image) ? image : null)
	}
	document.addEventListener("click", onClick, true)
	return () => document.removeEventListener("click", onClick, true)
}

/**
 * The slide on view changed (or the viewer just opened on it): the image on the page that shows it
 * becomes the plate the viewer closes into. None in view, and the viewer closes with a fade.
 */
export const followSlide = (viewer: Element, media: HTMLImageElement | null) => {
	if (media === null) return setOrigin(null)
	const source = sourceOf(media)
	const current = document.querySelector<HTMLImageElement>(`img[${ORIGIN_ATTRIBUTE}]`)
	if (current !== null && sourceOf(current) === source && isInView(current)) return
	const plate = [...document.querySelectorAll("img")].find(
		(image) =>
			!viewer.contains(image) && sourceOf(image) === source && isPainted(image) && isInView(image),
	)
	setOrigin(plate ?? null)
}

/** The plate the viewer closed into, for focus to return to. */
export const originPlate = (): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[${ORIGIN_ATTRIBUTE}]`)

/**
 * After a close, once its transition is over, the plate gives its name back. A viewer opened since
 * owns the mark by then (it was set by the press that opened it, or by the slide it shows).
 */
export const releaseOrigin = () => {
	window.setTimeout(() => {
		if (!isViewerOpen()) clearOrigin()
	}, RELEASE_AFTER_MS)
}
