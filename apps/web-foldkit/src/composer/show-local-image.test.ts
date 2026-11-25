// @vitest-environment jsdom
import { Effect, Stream } from "effect"
import { Mount } from "foldkit"
import { afterEach, describe, expect, test, vi } from "vitest"
import * as Draft from "./draft"

/** `ShowLocalImage` points the `<img>` at the file itself, and frees the object URL once it is gone. */

describe("ShowLocalImage", () => {
	afterEach(() => vi.restoreAllMocks())

	test("sets the image's src to the file's object URL, revoked when the Mount ends", async () => {
		const objectUrl = "blob:http://localhost/photo"
		const create = vi.fn(() => objectUrl)
		const revoke = vi.fn()
		URL.createObjectURL = create
		URL.revokeObjectURL = revoke
		const file = new File(["png"], "photo.png", { type: "image/png" })
		const image = document.createElement("img")

		const messages = await Effect.runPromise(
			Stream.runCollect(
				Draft.ShowLocalImage({ file }).f(image, Mount.liveViewStateChanges).pipe(Stream.take(1)),
			),
		)

		expect(create).toHaveBeenCalledWith(file)
		expect(image.getAttribute("src")).toBe(objectUrl)
		expect(Array.from(messages)).toEqual([Draft.Message.CompletedShowLocalImage()])
		expect(revoke).toHaveBeenCalledWith(objectUrl)
	})
})
