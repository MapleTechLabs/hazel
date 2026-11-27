// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { AttachmentId, ChannelId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../../../app/requests"
import { RunFileAction } from "../../files/actions"
import type { FileAttachment } from "../../files/attachments"
import { FilesMessage, FilesPageNoDeps } from "./FilesPage"

/** The Files tab: search, filter, the media strip, documents and the viewer. */

const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const file = (n: number, fileName: string): FileAttachment => ({
	id: AttachmentId.make(`00000000-0000-4000-8000-0000000f000${n}`),
	fileName,
	fileSize: 2048,
	url: `https://files.hazel.test/${fileName}`,
	uploadedAtMs: 0,
	uploader: null,
})
const banner = file(1, "banner.png")
const board = file(2, "board.jpg")
const clip = file(3, "clip.mp4")
const roadmap = file(4, "roadmap.pdf")
const files = [banner, board, clip, roadmap]

/** The live query's subscription key: its name and inputs. */
const FILES = `files:"${channelId}","https://cdn.test"`

const start = () => Scene.start(FilesPageNoDeps, { channelId, orgSlug: "hazel", cdnUrl: "https://cdn.test" })

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const tag = (name: string): Locator.Locator => ({
	description: `<hz:${name}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${name}`)),
})
const grid = (layout: string) => byProp("attachmentGrid", "layout", layout)
const names = (node: Locator.Node) =>
	(node.props?.["attachments"] as ReadonlyArray<{ readonly name: string }>).map((each) => each.name)

describe("files page", () => {
	test("loads, then shows media and documents with the count", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading files…")).toExist()
		s.subscription(FILES, FilesMessage.UpdatedAttachments({ attachments: files }))
		s.expect(byProp("progress", "label", "Loading files…")).toBeAbsent()
		expect(names(s.get(grid("grid")))).toEqual(["banner.png", "board.jpg"])
		expect(names(s.get(grid("list")))).toEqual(["roadmap.pdf"])
	})

	test("search and filter narrow the files, and say when nothing matches", () => {
		const s = start().subscription(FILES, FilesMessage.UpdatedAttachments({ attachments: files }))
		s.fire(byProp("select", "value", "all"), "change", { value: "document" })
		s.expect(grid("grid")).toBeAbsent()
		expect(names(s.get(grid("list")))).toEqual(["roadmap.pdf"])
		s.fire(tag("searchField"), "change", { value: "nothing", rev: 1, edit: 0 })
		s.expect(byProp("emptyState", "description", "Try another search or filter.")).toExist()
	})

	test("an empty channel says files will appear", () => {
		start()
			.subscription(FILES, FilesMessage.UpdatedAttachments({ attachments: [] }))
			.expect(byProp("emptyState", "description", "Files shared in this channel will appear here."))
			.toExist()
	})

	test("an image opens the viewer; a viewer action runs and toasts", () => {
		const s = start().subscription(FILES, FilesMessage.UpdatedAttachments({ attachments: files }))
		s.fire(grid("grid"), "press", { id: banner.id })
		expect(s.get(tag("lightbox")).props).toMatchObject({ open: true })
		s.fire(tag("lightbox"), "change", { index: 1 })
		expect(s.get(tag("lightbox")).props).toMatchObject({ open: true, index: 1 })
		s.fire(tag("lightbox"), "select", { id: "copyUrl" })
			.expectExact(RunFileAction.make({ action: "copyUrl", url: board.url, fileName: board.fileName }))
			.resolve(RunFileAction, "copiedUrl")
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "URL copied",
						description: "Image URL has been copied to clipboard.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
		s.fire(tag("lightbox"), "dismiss")
		expect(s.get(tag("lightbox")).props?.["open"]).toBeUndefined()
	})

	test("a document downloads without a toast", () => {
		start()
			.subscription(FILES, FilesMessage.UpdatedAttachments({ attachments: files }))
			.fire(grid("list"), "press", { id: roadmap.id })
			.expectExact(
				RunFileAction.make({ action: "download", url: roadmap.url, fileName: roadmap.fileName }),
			)
			.resolve(RunFileAction, "downloaded")
	})

	test("a row shows its type, upload time and uploader, and its own button downloads", () => {
		const s = start().subscription(
			FILES,
			FilesMessage.UpdatedAttachments({ attachments: files, nowMs: roadmap.uploadedAtMs + 86_400_000 }),
		)
		const rows = s.get(grid("list")).props?.["attachments"]
		expect(rows).toContainEqual(
			expect.objectContaining({ id: roadmap.id, fileType: "pdf", meta: "Yesterday" }),
		)
		s.fire(grid("list"), "download", { id: roadmap.id })
			.expectExact(
				RunFileAction.make({ action: "download", url: roadmap.url, fileName: roadmap.fileName }),
			)
			.resolve(RunFileAction, "downloaded")
	})

	test("with more media than one row, the last tile reads See all and opens All media", () => {
		const s = start().subscription(
			FILES,
			FilesMessage.UpdatedAttachments({ attachments: [file(5, "a.png"), ...files] }),
		)
		expect(s.get(grid("grid")).props?.["more"]).toBe(2)
		s.fire(grid("grid"), "pressMore", {})
			.expectExact(Navigate.make({ href: `/hazel/chat/${channelId}/files/media`, replace: false }))
			.resolve(Navigate, Component.noop)
		expect(s.get(tag("lightbox")).props?.["open"]).toBeUndefined()
	})
})
