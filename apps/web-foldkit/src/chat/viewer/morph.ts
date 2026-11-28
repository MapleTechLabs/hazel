/**
 * The image viewer's morph: the image grows out of the picture on the page (the plate) when the
 * viewer opens, and flies back into it when it closes.
 *
 * It runs on the viewer's own Mount, with transform, opacity and clip-path animations on the image
 * alone, not in a View Transition. A transition rode on the render that opened the viewer: when that
 * render ran over Foldkit's frame budget (a busy channel, development builds) Foldkit rendered it
 * plainly and the viewer just appeared, and every open snapshotted and crossfaded the whole page,
 * which phones pay for. Here nothing waits on the render, and only the image and the backdrop move.
 *
 * The plate is only known to the DOM: the one pressed to open the viewer, then whichever image on
 * the page shows the slide on view, so closing lands on the image that was being looked at.
 */

export const VIEWER_ATTRIBUTE = "data-image-viewer"
const ORIGIN_ATTRIBUTE = "data-image-viewer-origin"
/** Set on the viewer once its Mount has taken over its entrance; until then it is transparent. */
export const SHOWN_ATTRIBUTE = "data-shown"

const OPEN_MS = 360
const CLOSE_MS = 300
const FADE_MS = 180
/** Fast out, long settle: the image lands rather than stops. */
const EASE_OUT = "cubic-bezier(0.32, 0.72, 0, 1)"
/** The viewer's image is `rounded-md`. */
const MEDIA_RADIUS = 6

const isReducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

const isViewerOpen = () => document.querySelector(`[${VIEWER_ATTRIBUTE}]`) !== null

// THE PLATE

/** Marks the plate under the open viewer, hidden (`image-viewer.css`) so the image is never on screen twice. */
const HIDDEN_ATTRIBUTE = "data-image-viewer-hidden"

const hidePlate = (plate: Element | null) => {
	for (const hidden of document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`))
		if (hidden !== plate) hidden.removeAttribute(HIDDEN_ATTRIBUTE)
	plate?.setAttribute(HIDDEN_ATTRIBUTE, "")
}

const clearOrigin = () => {
	for (const marked of document.querySelectorAll(`[${ORIGIN_ATTRIBUTE}]`))
		marked.removeAttribute(ORIGIN_ATTRIBUTE)
}

const setOrigin = (image: HTMLImageElement | null) => {
	if (!image?.hasAttribute(ORIGIN_ATTRIBUTE)) {
		clearOrigin()
		image?.setAttribute(ORIGIN_ATTRIBUTE, "")
	}
	// A press only remembers; the plate hides once a viewer shows it.
	if (isViewerOpen()) hidePlate(image)
}

/** The bitmap has to be painted for the image to grow out of it. */
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
	if (current !== null && sourceOf(current) === source && isInView(current)) return setOrigin(current)
	const plate = [...document.querySelectorAll("img")].find(
		(image) =>
			!viewer.contains(image) && sourceOf(image) === source && isPainted(image) && isInView(image),
	)
	setOrigin(plate ?? null)
}

/** The plate the viewer closes into, for focus to return to. */
export const originPlate = (): HTMLImageElement | null =>
	document.querySelector<HTMLImageElement>(`img[${ORIGIN_ATTRIBUTE}]`)

/** The viewer is gone: the plate shows again and gives its mark back, unless a new viewer took it. */
export const releaseOrigin = () => {
	hidePlate(null)
	window.setTimeout(() => {
		if (!isViewerOpen()) clearOrigin()
	}, 0)
}

// THE MOTION

interface Box {
	readonly left: number
	readonly top: number
	readonly width: number
	readonly height: number
}

/** The plate's corner, which clips the image as it leaves or lands (its tile's, when it has none). */
const radiusOf = (plate: Element) => {
	const own = Number.parseFloat(getComputedStyle(plate).borderTopLeftRadius)
	if (own > 0) return own
	const parent = plate.parentElement
	const tile = parent === null ? 0 : Number.parseFloat(getComputedStyle(parent).borderTopLeftRadius)
	return tile > 0 ? tile : MEDIA_RADIUS
}

/**
 * The keyframe that draws an image laid out in `box` as the plate shows it: moved and scaled onto
 * the plate, and cropped to it as `object-fit: cover` crops (the clip is in the image's own,
 * unscaled pixels, about its centre, which is where the transform scales from).
 */
const onPlate = (plate: Box, box: Box, radius: number): Keyframe => {
	const scale = Math.max(plate.width / box.width, plate.height / box.height)
	const dx = plate.left + plate.width / 2 - (box.left + box.width / 2)
	const dy = plate.top + plate.height / 2 - (box.top + box.height / 2)
	const insetX = Math.max(0, (box.width - plate.width / scale) / 2)
	const insetY = Math.max(0, (box.height - plate.height / scale) / 2)
	return {
		transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
		clipPath: `inset(${insetY}px ${insetX}px round ${radius / scale}px)`,
	}
}

const AT_REST: Keyframe = {
	transform: "translate(0px, 0px) scale(1)",
	clipPath: `inset(0px 0px round ${MEDIA_RADIUS}px)`,
}

/** Everything around the image: the counter, toolbar, author, step buttons, thumbnails, captions. */
const chromeOf = (viewer: Element) => [
	...viewer.querySelectorAll<HTMLElement>("[data-viewer-chrome], [data-viewer-caption]"),
]

const backdropOf = (viewer: Element) => viewer.querySelector<HTMLElement>("[data-viewer-backdrop]")

/** Waits briefly for the open slide's bitmap; the plate's is cached, so this is usually at once. */
const whenDecoded = (media: HTMLImageElement, timeoutMs: number): Promise<boolean> =>
	isPainted(media)
		? Promise.resolve(true)
		: Promise.race([
				media.decode().then(
					() => isPainted(media),
					() => false,
				),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
			])

/**
 * The entrance, run as the viewer mounts: the image grows out of the plate while the backdrop and
 * chrome fade in, or, with no plate, everything fades in. Returns a cancel for a viewer torn down
 * mid-entrance.
 */
export const morphOpen = (viewer: Element, media: HTMLImageElement | null): (() => void) => {
	const animations: Array<Animation> = []
	let isCancelled = false
	const plate = originPlate()
	const fade = () => {
		// The plate of the slide on view now (it may have changed while the entrance waited).
		hidePlate(originPlate())
		viewer.setAttribute(SHOWN_ATTRIBUTE, "")
		animations.push(
			viewer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" }),
		)
	}
	const grow = (from: HTMLImageElement, to: HTMLImageElement) => {
		const keyframe = onPlate(from.getBoundingClientRect(), to.getBoundingClientRect(), radiusOf(from))
		hidePlate(from)
		viewer.setAttribute(SHOWN_ATTRIBUTE, "")
		const backdrop = backdropOf(viewer)
		animations.push(
			to.animate([keyframe, AT_REST], { duration: OPEN_MS, easing: EASE_OUT }),
			...(backdrop === null
				? []
				: [
						backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
							duration: OPEN_MS * 0.75,
							easing: "ease-out",
						}),
					]),
			...chromeOf(viewer).map((part) =>
				part.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 200,
					delay: OPEN_MS * 0.4,
					easing: "ease-out",
					fill: "backwards",
				}),
			),
		)
	}
	if (isReducedMotion() || media === null || plate === null || !isPainted(plate) || !isInView(plate)) fade()
	else if (isPainted(media)) grow(plate, media)
	else {
		// Not drawn yet: the viewer stays transparent for the wait and the plate stays on the page, then
		// the image grows, or the viewer fades if it never came or another slide was chosen meanwhile.
		hidePlate(null)
		void whenDecoded(media, 200).then((isDecoded) => {
			if (isCancelled) return
			const isStillOnView = media.isConnected && media.hasAttribute("data-active")
			if (isDecoded && isStillOnView && originPlate() === plate && isInView(plate)) grow(plate, media)
			else fade()
		})
	}
	return () => {
		isCancelled = true
		for (const animation of animations) animation.cancel()
	}
}

/**
 * The exit, before the viewer is closed: the image flies from where it is now (zoomed, or pulled
 * away) back onto the plate while everything else fades, or the viewer fades with no plate in view.
 * A copy of the image flies, outside the slide's transforms; it is removed in the frame the plate
 * shows again, so the picture is never missing and never doubled. Resolves when the viewer may go.
 */
export const morphClose = (viewer: Element, media: HTMLImageElement | null): Promise<void> => {
	if (viewer instanceof HTMLElement) viewer.style.pointerEvents = "none"
	const plate = originPlate()
	const fadeOthers = (duration: number, fromBackdrop: boolean) => {
		const backdrop = backdropOf(viewer)
		const others = [
			...(backdrop === null
				? []
				: [
						backdrop.animate(
							[
								{ opacity: fromBackdrop ? getComputedStyle(backdrop).opacity : 1 },
								{ opacity: 0 },
							],
							{ duration, easing: "ease-out", fill: "forwards" },
						),
					]),
			...chromeOf(viewer).map((part) =>
				part.animate([{ opacity: getComputedStyle(part).opacity }, { opacity: 0 }], {
					duration: Math.min(duration, 150),
					easing: "ease-out",
					fill: "forwards",
				}),
			),
		]
		return Promise.all(others.map((animation) => animation.finished)).then(
			() => undefined,
			() => undefined,
		)
	}
	if (isReducedMotion() || media === null || !isPainted(media)) {
		return viewer
			.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: FADE_MS,
				easing: "ease-out",
				fill: "forwards",
			})
			.finished.then(
				() => undefined,
				() => undefined,
			)
	}
	const box = media.getBoundingClientRect()
	// Closed mid-entrance, the image is still cropped toward its plate: the copy starts from that crop,
	// which is in the image's own pixels, so scaled to the copy's (the transformed box).
	const scale = media.offsetWidth > 0 ? box.width / media.offsetWidth : 1
	const crop = getComputedStyle(media).clipPath
	const from: Keyframe = crop.startsWith("inset(")
		? {
				transform: "translate(0px, 0px) scale(1)",
				clipPath: crop.replace(/(-?[\d.]+)px/g, (_, value: string) => `${Number(value) * scale}px`),
			}
		: AT_REST
	for (const animation of media.getAnimations()) animation.cancel()
	const copy = media.cloneNode(false) as HTMLImageElement
	for (const name of copy.getAttributeNames())
		if (name !== "src" && name !== "alt" && name !== "srcset" && name !== "sizes")
			copy.removeAttribute(name)
	copy.setAttribute("aria-hidden", "true")
	copy.decoding = "sync"
	Object.assign(copy.style, {
		position: "fixed",
		left: `${box.left}px`,
		top: `${box.top}px`,
		width: `${box.width}px`,
		height: `${box.height}px`,
		margin: "0",
		maxWidth: "none",
		maxHeight: "none",
		zIndex: "10000",
		pointerEvents: "none",
		transformOrigin: "50% 50%",
		willChange: "transform",
	})
	document.body.append(copy)
	media.style.opacity = "0"
	const isLanding = plate !== null && isPainted(plate) && isInView(plate)
	const flight = isLanding
		? copy.animate([from, onPlate(plate.getBoundingClientRect(), box, radiusOf(plate))], {
				duration: CLOSE_MS,
				easing: EASE_OUT,
				fill: "forwards",
			})
		: copy.animate(
				[
					{ opacity: 1, transform: "scale(1)" },
					{ opacity: 0, transform: "scale(0.94)" },
				],
				{ duration: FADE_MS, easing: "ease-out", fill: "forwards" },
			)
	const others = fadeOthers(isLanding ? CLOSE_MS * 0.8 : FADE_MS, true)
	return Promise.all([
		flight.finished.then(
			() => undefined,
			() => undefined,
		),
		others,
	]).then(() => {
		// The plate shows in the same frame its copy goes.
		hidePlate(null)
		copy.remove()
	})
}
