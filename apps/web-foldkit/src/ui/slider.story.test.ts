// @vitest-environment jsdom
// jsdom only because ./aria/interaction reads `document` at import time.
import { Command, expectNoOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { FocusThumb, init, Message, update } from "./slider"

/** React Aria Slider state: native input changes, Page/Home/End keys, track press and drag. */

const volume = init({ id: "volume", values: [40] })
const price = init({ id: "price", values: [20, 70] })
const key = (value: string, index = 0) => message(Message.PressedThumbKey({ index, key: value }))
const input = (value: string, index = 0) => message(Message.ChangedThumbInput({ index, value }))

describe("slider story", () => {
	test("PageUp and PageDown move the thumb by a tenth of the range", () => {
		story(
			update,
			given(volume),
			key("PageUp"),
			Command.expectNone(),
			model((next) => expect(next.values).toEqual([50])),
			key("PageDown"),
			key("PageDown"),
			model((next) => expect(next.values).toEqual([30])),
		)
	})

	test("Home and End jump the thumb to the minimum and maximum", () => {
		story(
			update,
			given(init({ id: "volume", values: [40], minValue: 10, maxValue: 90 })),
			key("End"),
			model((next) => expect(next.values).toEqual([90])),
			key("Home"),
			model((next) => expect(next.values).toEqual([10])),
		)
	})

	test("PageUp never moves less than one step on a narrow range", () => {
		story(
			update,
			given(init({ id: "rating", values: [2], minValue: 0, maxValue: 5, step: 1 })),
			key("PageUp"),
			model((next) => expect(next.values).toEqual([3])),
		)
	})

	test("arrow key input from the native range snaps to the step", () => {
		story(
			update,
			given(init({ id: "volume", values: [40], step: 5 })),
			input("42"),
			model((next) => expect(next.values).toEqual([40])),
			input("43"),
			model((next) => expect(next.values).toEqual([45])),
		)
	})

	test("values beyond the range are clamped to the minimum and maximum", () => {
		story(
			update,
			given(volume),
			input("150"),
			model((next) => expect(next.values).toEqual([100])),
			input("-20"),
			model((next) => expect(next.values).toEqual([0])),
			key("PageDown"),
			model((next) => expect(next.values).toEqual([0])),
		)
	})

	test("a range thumb cannot pass its neighbour", () => {
		story(
			update,
			given(price),
			input("90", 0),
			model((next) => expect(next.values).toEqual([70, 70])),
			key("Home", 1),
			model((next) => expect(next.values).toEqual([70, 70])),
		)
		story(
			update,
			given(price),
			key("End", 0),
			key("Home", 1),
			model((next) => expect(next.values).toEqual([70, 70])),
		)
	})

	// T9: snapping rounds to the step's precision, as React Aria's roundToStepPrecision does.
	test("a decimal step lands exactly on the step value", () => {
		story(
			update,
			given(init({ id: "opacity", values: [0], minValue: 0, maxValue: 1, step: 0.1 })),
			input("0.3"),
			model((next) => expect(next.values).toEqual([0.3])),
			input("0.7"),
			model((next) => expect(next.values).toEqual([0.7])),
		)
	})
})

describe("slider story: pointer", () => {
	test("pressing the track moves the closest thumb, starts a drag and focuses that thumb", () => {
		story(
			update,
			given(price),
			message(Message.PressedTrack({ value: 60, inputPrefix: "price-label" })),
			Command.expectExact(FocusThumb({ inputId: "price-label-1" })),
			Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
			model((next) => {
				expect(next.values).toEqual([20, 60])
				expect(next.dragging).toBe(1)
			}),
		)
	})

	test("pressing the track below the first thumb picks the first thumb", () => {
		story(
			update,
			given(price),
			message(Message.PressedTrack({ value: 5.4, inputPrefix: "price-label" })),
			Command.expectExact(FocusThumb({ inputId: "price-label-0" })),
			Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
			model((next) => expect(next.values).toEqual([5, 70])),
		)
	})

	test("dragging moves the pressed thumb until the pointer is released", () => {
		story(
			update,
			given(volume),
			message(Message.PressedTrack({ value: 10, inputPrefix: "volume-label" })),
			Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
			message(Message.MovedDragPointer({ value: 72.6 })),
			model((next) => expect(next.values).toEqual([73])),
			message(Message.ReleasedDragPointer()),
			model((next) => expect(next.dragging).toBeNull()),
			message(Message.MovedDragPointer({ value: 20 })),
			model((next) => expect(next.values).toEqual([73])),
		)
	})

	test("value changes are not reported to the parent as an OutMessage", () => {
		story(update, given(volume), key("End"), expectNoOutMessage())
	})
})
