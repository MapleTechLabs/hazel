// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { AttachmentId, ChannelId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../../../../app/requests"
import { RunFileAction } from "../../../files/actions"
import type { FileAttachment } from "../../../files/attachments"
import { countsLine, MediaMessage, MediaPageNoDeps } from "./MediaPage"

/** All media: counts, masonry, the viewer, videos in a tab, and back to Files. */

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
const clip = file(2, "clip.mp4")
const roadmap = file(3, "roadmap.pdf")

const FILES = `files:"${channelId}","https://cdn.test"`
const start = () => Scene.start(MediaPageNoDeps, { channelId, orgSlug: "hazel", cdnUrl: "https://cdn.test" })

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const tag = (name: string): Locator.Locator => ({
	description: `<hz:${name}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${name}`)),
})
const masonry = byProp("attachmentGrid", "layout", "masonry")

describe("media page", () => {
	test("counts photos and videos", () => {
		expect(countsLine([banner])).toBe("1 photo")
		expect(countsLine([banner, banner, clip])).toBe("2 photos, 1 video")
	})

	test("loads, then draws every image and video, not documents", () => {
		const s = start()
		s.expect(byProp("progress", "label", "Loading media…")).toExist()
		s.subscription(FILES, MediaMessage.UpdatedAttachments({ attachments: [banner, clip, roadmap] }))
		const names = (s.get(masonry).props?.["attachments"] as ReadonlyArray<{ name: string }>).map(
			(each) => each.name,
		)
		expect(names).toEqual(["banner.png", "clip.mp4"])
	})

	test("no media says so", () => {
		start()
			.subscription(FILES, MediaMessage.UpdatedAttachments({ attachments: [roadmap] }))
			.expect(byProp("emptyState", "title", "No media yet"))
			.toExist()
	})

	test("an image opens the viewer and saves with a toast; a video opens in a tab", () => {
		const s = start().subscription(FILES, MediaMessage.UpdatedAttachments({ attachments: [banner, clip] }))
		s.fire(masonry, "press", { id: banner.id })
		expect(s.get(tag("lightbox")).props).toMatchObject({ open: true })
		s.fire(tag("lightbox"), "select", { id: "download" })
			.expectExact(RunFileAction.make({ action: "download", url: banner.url, fileName: banner.fileName }))
			.resolve(RunFileAction, "downloaded")
			.expectExact(
				ShowToast.make({
					toast: { intent: "success", title: "Image downloaded", description: "Your image has been downloaded." },
				}),
			)
			.resolve(ShowToast, Component.noop)
			.fire(tag("lightbox"), "dismiss")
			.fire(masonry, "press", { id: clip.id })
			.expectExact(RunFileAction.make({ action: "openInBrowser", url: clip.url, fileName: clip.fileName }))
			.resolve(RunFileAction, "opened")
	})

	test("back goes to Files", () => {
		start()
			.fire(tag("screen"), "back")
			.expectExact(Navigate.make({ href: `/hazel/chat/${channelId}/files`, replace: false }))
			.resolve(Navigate, Component.noop)
	})
})
