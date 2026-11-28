import "../styles.css"
import { Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { imageViewerView, type ImageViewerImage } from "./image-viewer"
import { installImageViewerMorph } from "./viewer/morph"

/**
 * The image viewer in Chromium: the real Mounts, gestures and morph, in a small Foldkit
 * element shaped like the channel (plates on the page, the viewer over them).
 */

const shot = (hue: number, label: string) => {
	const canvas = document.createElement("canvas")
	canvas.width = 2400
	canvas.height = 1500
	const context = canvas.getContext("2d")
	if (context === null) throw new Error("no 2d context")
	context.fillStyle = `hsl(${hue} 70% 45%)`
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.fillStyle = "white"
	context.font = "bold 240px sans-serif"
	context.fillText(label, 200, 800)
	return canvas.toDataURL("image/png")
}

let images: ReadonlyArray<ImageViewerImage> = []
beforeAll(() => {
	images = [0, 120, 240].map((hue, index) => ({
		id: `image-${index}`,
		fileName: `photo-${index + 1}.png`,
		fileSize: 0,
		url: shot(hue, `#${index + 1}`),
	}))
})

const Message = defineMessageUnion({
	ClickedPlate: { index: Schema.Finite },
	Closed: {},
	Selected: { index: Schema.Finite },
})
type Message = typeof Message.Type
const Model = Schema.Struct({ openIndex: Schema.NullOr(Schema.Finite) })
type Model = typeof Model.Type

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex gap-4 p-8")],
		[
			...images.map((image, index) =>
				h.button(
					[h.Type("button"), h.Class("block"), h.OnClick(Message.ClickedPlate({ index }))],
					[
						h.img([
							h.Attribute("src", image.url),
							h.Attribute("alt", image.fileName),
							h.DataAttribute("plate", ""),
							h.Class("w-48"),
						]),
					],
				),
			),
			model.openIndex === null
				? h.empty
				: imageViewerView(h, {
						images,
						index: model.openIndex,
						author: { name: "Grace", avatarUrl: null, seed: "Grace" },
						createdAtMs: 0,
						toClose: () => Message.Closed(),
						toSelect: (index) => Message.Selected({ index }),
					}),
		],
	)

const update = (model: Model, message: Message) =>
	Message.match(message, {
		ClickedPlate: ({ index }) => ({ model: { openIndex: index } }),
		Closed: () => ({ model: { openIndex: null } }),
		Selected: ({ index }) => ({ model: model.openIndex === null ? model : { openIndex: index } }),
	})

let releaseMorph = () => {}

const start = async () => {
	await page.viewport(1280, 800)
	releaseMorph = installImageViewerMorph()
	const container = document.createElement("div")
	container.id = "image-viewer-test"
	document.body.append(container)
	void Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model: { openIndex: null } }),
			update,
			view,
			container,
		}),
	)
	await waitFor(() => document.querySelectorAll("img[data-plate]").length === 3)
	await Promise.all([...document.images].map((image) => image.decode()))
}

const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
	const startedAt = performance.now()
	while (!check()) {
		if (performance.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${check}`)
		await new Promise((resolve) => setTimeout(resolve, 16))
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const viewer = () => document.querySelector<HTMLElement>("[data-image-viewer]")
const content = () => document.querySelector<HTMLElement>("[data-viewer-content]")
const counter = () => content()?.querySelector("[aria-hidden=true].tabular-nums")?.textContent ?? ""
const activeSlide = () => document.querySelector<HTMLElement>("[data-viewer-slide][data-active]")
const activeZoom = () => activeSlide()?.querySelector<HTMLElement>("[data-viewer-zoom]") ?? null
const activeMedia = () => activeSlide()?.querySelector<HTMLImageElement>("[data-viewer-media]") ?? null
const plate = (index: number) => document.querySelectorAll<HTMLImageElement>("img[data-plate]")[index]
const scaleOf = (element: HTMLElement | null) =>
	element === null ? 1 : new DOMMatrixReadOnly(getComputedStyle(element).transform).a
const zoomButton = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const open = async (index: number) => {
	const target = plate(index)
	if (target === undefined) throw new Error("no plate")
	await userEvent.click(target)
	await waitFor(() => viewer() !== null && activeMedia() !== null)
	// The entrance.
	await sleep(450)
}

afterEach(() => {
	releaseMorph()
})

describe("image viewer in a real browser", () => {
	test("opens on the pressed image, growing out of it, with focus in the dialog", async () => {
		await start()
		const target = plate(1) as HTMLImageElement
		await userEvent.click(target)
		await waitFor(() => viewer() !== null && activeMedia() !== null)
		// Mid-entrance the image is still near the plate, cropped to it.
		const grow = activeMedia()?.getAnimations()[0]
		expect(grow).toBeDefined()
		grow?.pause()
		if (grow !== undefined) grow.currentTime = 0
		const start0 = (activeMedia() as HTMLElement).getBoundingClientRect()
		const from = target.getBoundingClientRect()
		expect(Math.abs(start0.left + start0.width / 2 - (from.left + from.width / 2))).toBeLessThan(2)
		expect(Math.abs(start0.top + start0.height / 2 - (from.top + from.height / 2))).toBeLessThan(2)
		grow?.play()
		await sleep(450)
		expect(activeMedia()?.getAnimations()).toHaveLength(0)
		expect(counter()).toBe("2 of 3")
		expect(plate(1)?.hasAttribute("data-image-viewer-origin")).toBe(true)
		// The plate stays on the page, hidden, so the image is never on screen twice.
		expect(getComputedStyle(plate(1) as HTMLElement).visibility).toBe("hidden")
		expect(document.activeElement).toBe(content())
		expect(content()?.getAttribute("role")).toBe("dialog")
		// The track sits on the open slide.
		const track = document.querySelector<HTMLElement>("[data-viewer-slides]")
		expect(Math.abs((track?.scrollLeft ?? 0) - (activeSlide()?.offsetLeft ?? -1))).toBeLessThan(2)
	})

	test("arrow keys turn the page, and the plate the viewer closes into follows", async () => {
		await userEvent.keyboard("{ArrowRight}")
		await waitFor(() => counter() === "3 of 3")
		await waitFor(() => plate(2)?.hasAttribute("data-image-viewer-origin") === true)
		expect(plate(1)?.hasAttribute("data-image-viewer-origin")).toBe(false)
		// At the end the page stays put.
		await userEvent.keyboard("{ArrowRight}")
		await sleep(100)
		expect(counter()).toBe("3 of 3")
		await userEvent.keyboard("{Home}")
		await waitFor(() => counter() === "1 of 3")
	})

	test("zooms with the buttons and the keys, and pans while zoomed", async () => {
		expect(zoomButton("Zoom out")?.getAttribute("aria-disabled")).toBe("true")
		zoomButton("Zoom in")?.click()
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(2, 1)
		expect(content()?.hasAttribute("data-zoomed")).toBe(true)
		expect(zoomButton("Zoom out")?.getAttribute("aria-disabled")).toBe("false")
		// Arrows pan a zoomed image instead of turning the page.
		const before = new DOMMatrixReadOnly(getComputedStyle(activeZoom() as HTMLElement).transform).e
		await userEvent.keyboard("{ArrowRight}")
		await sleep(250)
		const after = new DOMMatrixReadOnly(getComputedStyle(activeZoom() as HTMLElement).transform).e
		expect(counter()).toBe("1 of 3")
		expect(after).toBeLessThan(before)
		await userEvent.keyboard("0")
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(1, 2)
		expect(content()?.hasAttribute("data-zoomed")).toBe(false)
		await userEvent.keyboard("+")
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(2, 1)
		await userEvent.keyboard("-")
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(1, 2)
	})

	test("a click on the image zooms toward it, and a second click zooms back out", async () => {
		await userEvent.click(activeMedia() as HTMLElement)
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(2, 1)
		await userEvent.click(activeMedia() as HTMLElement)
		await sleep(400)
		expect(scaleOf(activeZoom())).toBeCloseTo(1, 2)
	})

	test("ctrl + wheel (a trackpad pinch) zooms about the pointer", async () => {
		const media = activeMedia() as HTMLElement
		const box = media.getBoundingClientRect()
		for (let tick = 0; tick < 5; tick++)
			media.dispatchEvent(
				new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					ctrlKey: true,
					deltaY: -20,
					clientX: box.left + box.width * 0.25,
					clientY: box.top + box.height * 0.25,
				}),
			)
		expect(scaleOf(activeZoom())).toBeGreaterThan(1.5)
		await userEvent.keyboard("0")
		await sleep(400)
	})

	test("a wheel pull past the threshold dismisses, and focus returns to the plate", async () => {
		const media = activeMedia() as HTMLElement
		for (let tick = 0; tick < 6; tick++) {
			media.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 30 }))
			await sleep(10)
		}
		// The image flies back from where the pull let go, then the viewer closes.
		await waitFor(() => viewer() === null)
		await sleep(50)
		expect(document.activeElement).toBe(plate(0)?.closest("button"))
		expect(getComputedStyle(plate(0) as HTMLElement).visibility).toBe("visible")
		expect(document.querySelectorAll("img").length).toBe(3)
		expect(document.querySelector("[data-image-viewer-origin]")).toBeNull()
	})

	test("a short wheel pull snaps back", async () => {
		await open(0)
		const media = activeMedia() as HTMLElement
		media.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 30 }))
		expect(viewer()?.hasAttribute("data-pulling")).toBe(true)
		await sleep(500)
		expect(viewer()).not.toBeNull()
		expect(viewer()?.hasAttribute("data-pulling")).toBe(false)
	})

	test("a click beside the image closes; Escape closes", async () => {
		const slide = activeSlide() as HTMLElement
		await userEvent.click(slide, { position: { x: 8, y: slide.clientHeight / 2 } })
		await waitFor(() => viewer() === null)
		await sleep(450)
		await open(2)
		await userEvent.keyboard("{Escape}")
		await waitFor(() => viewer() === null)
		await sleep(450)
		expect(document.activeElement).toBe(plate(2)?.closest("button"))
	})

	test("the close button flies the image back into its plate before closing", async () => {
		await open(1)
		document.querySelector<HTMLElement>('button[aria-label="Close"]')?.click()
		// The exit runs first: the viewer is still there, and a copy of the image is in flight.
		await sleep(60)
		expect(viewer()).not.toBeNull()
		const copy = [...document.querySelectorAll<HTMLImageElement>("body > img")].at(-1)
		expect(copy?.getAnimations().length).toBe(1)
		await waitFor(() => viewer() === null)
		expect(document.querySelectorAll("body > img").length).toBe(0)
		expect(getComputedStyle(plate(1) as HTMLElement).visibility).toBe("visible")
	})

	test("the step buttons and thumbnails select an image", async () => {
		await open(0)
		await userEvent.click(document.querySelector('button[aria-label="Next image"]') as HTMLElement)
		await waitFor(() => counter() === "2 of 3")
		await userEvent.click(document.querySelector('button[aria-label="photo-3.png"]') as HTMLElement)
		await waitFor(() => counter() === "3 of 3")
		const track = document.querySelector<HTMLElement>("[data-viewer-slides]")
		await waitFor(() => Math.abs((track?.scrollLeft ?? 0) - (activeSlide()?.offsetLeft ?? -1)) < 2)
		await userEvent.keyboard("{Escape}")
		await waitFor(() => viewer() === null)
	})

	test("a thumbnail pressed while the track still moves lands the track on it", async () => {
		await sleep(450)
		await open(0)
		const track = document.querySelector<HTMLElement>("[data-viewer-slides]") as HTMLElement
		// A swipe toward the second slide, still in flight (a phone's momentum) when the press lands.
		track.scrollTo({ left: track.clientWidth, behavior: "smooth" })
		await waitFor(() => track.scrollLeft > 0)
		document.querySelector<HTMLElement>('button[aria-label="photo-3.png"]')?.click()
		await waitFor(() => counter() === "3 of 3")
		// The swipe runs out without taking the selection back.
		await sleep(600)
		expect(counter()).toBe("3 of 3")
		expect(activeMedia()?.getAttribute("alt")).toBe("photo-3.png")
		expect(Math.abs(track.scrollLeft - (activeSlide()?.offsetLeft ?? -1))).toBeLessThan(2)
		await userEvent.keyboard("{Escape}")
		await waitFor(() => viewer() === null)
	})
})
