// @vitest-environment jsdom
import { ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { describe, expect, test } from "vitest"
import * as Composer from "./composer"
import * as Draft from "./draft"
import * as DraftUpdate from "./draft-update"
import { draftView } from "./draft-view"
import { DragState, DropEvent } from "./drop"
import * as EditorCommands from "./editor-commands"

/**
 * The keys the editor hands to the draft (Escape, ArrowUp in an empty composer, Enter), through the
 * draft's view: the reply and edit banners they change, and the editor Commands they send back.
 * The editor's own handling of each key is `editor/keyboard.test.ts`.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const ada = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(4))
const memberId = Schema.decodeSync(ChannelMemberId)(uuid(5))
const replyId = Schema.decodeSync(MessageId)(uuid(1001))
const lastOwnId = Schema.decodeSync(MessageId)(uuid(1002))
const editorId = "composer-keys"
const lastOwnContent = "Shipped the onboarding copy"

const context: Draft.Context = {
	currentUserId: ada,
	organizationId,
	memberId,
	lastOwnMessage: { id: lastOwnId, content: lastOwnContent },
}
const config = (draftContext: Draft.Context = context) => ({
	update: (model: Draft.Model, message: Draft.Message) => DraftUpdate.update(model, message, draftContext),
	view: (model: Draft.Model, h: HtmlBuilder<Draft.Message>) =>
		draftView(h, model, {
			toMessage: (message) => message,
			replyPreview: { authorName: "Grace Hopper", firstLine: "Can someone review the PR?" },
			attachmentInfo: () => null,
		}),
})

/**
 * Where the editor's Mount sits in a rendered tree, as the patch matches it: by key where an element
 * has one, else by tag and index. While this path holds, the patch keeps the editor's element (and
 * its focus); a change means the editor is rebuilt and the focus falls to <body>.
 */
const mountNameOf = (data: unknown): string | undefined => {
	if (typeof data !== "object" || data === null || !("foldkitMount" in data)) return undefined
	const marker: unknown = data.foldkitMount
	return typeof marker === "object" &&
		marker !== null &&
		"name" in marker &&
		typeof marker.name === "string"
		? marker.name
		: undefined
}
const editorPath = (node: Html, path: ReadonlyArray<string> = []): ReadonlyArray<string> | null => {
	if (node === null) return null
	if (mountNameOf(node.data) === "MountEditor") return path
	for (const [index, child] of (node.children ?? []).entries()) {
		if (typeof child === "string") continue
		const step = child.key === undefined ? `${child.sel}@${index}` : `#${String(child.key)}`
		const found = editorPath(child, [...path, step])
		if (found !== null) return found
	}
	return null
}
/** The scene's config, recording the editor's path on every render. */
const recordingConfig = (draftContext: Draft.Context = context) => {
	const paths: Array<string> = []
	const base = config(draftContext)
	return {
		paths,
		config: {
			...base,
			view: (model: Draft.Model, h: HtmlBuilder<Draft.Message>) => {
				const html = base.view(model, h)
				paths.push(JSON.stringify(editorPath(html)))
				return html
			},
		},
	}
}
const expectEditorKept = (paths: ReadonlyArray<string>) => {
	expect(paths[0]).not.toBe("null")
	expect(new Set(paths)).toEqual(new Set([paths[0]]))
}

const fresh = () => Draft.init(channelId, editorId)
const withDraft = (model: Draft.Model, markdown: string): Draft.Model => ({
	...model,
	composer: { ...model.composer, markdown },
})
const replying = (markdown = ""): Draft.Model =>
	withDraft({ ...fresh(), composeMode: Draft.ComposeMode.Replying({ messageId: replyId }) }, markdown)
const editing = (): Draft.Model =>
	withDraft(
		{ ...fresh(), composeMode: Draft.ComposeMode.Editing({ messageId: lastOwnId, hadText: true }) },
		lastOwnContent,
	)

/**
 * The editor reports a key: its Mount is the source of these Messages. Matched by name, since the
 * scene hands the result to the draft's update as is, past the view's `Mount.mapMessage`.
 */
const editorReports = (message: Composer.Message) =>
	Scene.Mount.resolve({ name: "MountEditor" }, Draft.Message.GotComposerMessage({ message }))
/** A later key from the same editor: its Mount resolved already, its stream goes on. */
const editorReportsAgain = (message: Composer.Message) =>
	Scene.Subscription.emit(Draft.Message.GotComposerMessage({ message }))
const dropZoneIdle = Scene.Mount.resolve(
	{ name: "TrackFileDrop" },
	Draft.Message.ReceivedDropEvent({ event: DropEvent.ChangedDragState({ drag: DragState.Idle() }) }),
)

const replyBanner = Scene.text("Replying to")
const editBanner = Scene.text("Editing message")

describe("Escape", () => {
	test("Escape while replying cancels the reply and keeps what was typed", () => {
		Scene.scene(
			config(),
			Scene.given(replying("half a thought")),
			Scene.expect(replyBanner).toExist(),
			dropZoneIdle,
			editorReports(Composer.Message.PressedEscape()),
			Scene.expect(replyBanner).toBeAbsent(),
			Scene.Command.expectNone(),
		)
	})

	test("Escape while editing leaves edit mode and clears the editor", () => {
		Scene.scene(
			config(),
			Scene.given(editing()),
			Scene.expect(editBanner).toExist(),
			dropZoneIdle,
			editorReports(Composer.Message.PressedEscape()),
			Scene.expect(editBanner).toBeAbsent(),
			Scene.Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Scene.Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
		)
	})

	test("Escape with nothing to cancel asks to mark the channel read (Discord)", () => {
		Scene.scene(
			config(),
			Scene.given(fresh()),
			dropZoneIdle,
			editorReports(Composer.Message.PressedEscape()),
			Scene.Command.expectNone(),
			Scene.expectOutMessage(Draft.OutMessage.RequestedMarkRead()),
		)
	})

	test("the reply's Cancel button does the same", () => {
		Scene.scene(
			config(),
			Scene.given(replying()),
			dropZoneIdle,
			editorReports(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true })),
			Scene.click(Scene.role("button", { name: "Cancel reply" })),
			Scene.expect(replyBanner).toBeAbsent(),
		)
	})
})

describe("ArrowUp in an empty composer", () => {
	test("edits your last message: the banner shows and the editor gets its text", () => {
		Scene.scene(
			config(),
			Scene.given(fresh()),
			dropZoneIdle,
			editorReports(Composer.Message.PressedArrowUpInEmpty()),
			Scene.expect(editBanner).toExist(),
			Scene.Command.expectExact(
				EditorCommands.SetEditorContent({ editorId, markdown: lastOwnContent }),
			),
			Scene.Command.resolve(
				EditorCommands.SetEditorContent,
				Composer.Message.CompletedSetEditorContent(),
			),
		)
	})

	test("with no message of yours in the channel it does nothing", () => {
		Scene.scene(
			config({ ...context, lastOwnMessage: null }),
			Scene.given(fresh()),
			dropZoneIdle,
			editorReports(Composer.Message.PressedArrowUpInEmpty()),
			Scene.expect(editBanner).toBeAbsent(),
			Scene.Command.expectNone(),
		)
	})
})

describe("the editor keeps its element (and focus) as banners come and go", () => {
	test("ArrowUp to edit, then Escape: the edit banner appears and leaves around the same editor", () => {
		const { paths, config: recording } = recordingConfig()
		Scene.scene(
			recording,
			Scene.given(fresh()),
			dropZoneIdle,
			editorReports(Composer.Message.PressedArrowUpInEmpty()),
			Scene.expect(editBanner).toExist(),
			Scene.Command.resolve(
				EditorCommands.SetEditorContent,
				Composer.Message.CompletedSetEditorContent(),
			),
			editorReportsAgain(Composer.Message.PressedEscape()),
			Scene.expect(editBanner).toBeAbsent(),
			Scene.Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
		)
		expectEditorKept(paths)
	})

	test("replying, then Escape: the reply banner leaves around the same editor", () => {
		const { paths, config: recording } = recordingConfig()
		Scene.scene(
			recording,
			Scene.given(replying("half a thought")),
			dropZoneIdle,
			editorReports(Composer.Message.PressedEscape()),
			Scene.expect(replyBanner).toBeAbsent(),
		)
		expectEditorKept(paths)
	})

	test("dragging a file over the page shows the drop overlay around the same editor", () => {
		const { paths, config: recording } = recordingConfig()
		Scene.scene(
			recording,
			Scene.given(fresh()),
			editorReports(Composer.Message.UpdatedDraft({ markdown: "", isEmpty: true })),
			Scene.Mount.resolve(
				{ name: "TrackFileDrop" },
				Draft.Message.ReceivedDropEvent({
					event: DropEvent.ChangedDragState({ drag: DragState.DraggingOnPage() }),
				}),
			),
			Scene.expect(Scene.text("Drop files here")).toExist(),
		)
		expectEditorKept(paths)
	})
})

describe("Enter", () => {
	test("Enter sends the reply and clears the reply banner", () => {
		Scene.scene(
			config(),
			Scene.given(replying("on it")),
			dropZoneIdle,
			editorReports(Composer.Message.SubmittedDraft({ markdown: "on it" })),
			Scene.expect(replyBanner).toBeAbsent(),
			Scene.Command.expectHas(EditorCommands.ClearEditor({ editorId })),
			Scene.Command.resolveAll(
				[EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()],
				[Draft.SendMessage, Draft.Message.SucceededSendMessage()],
			),
		)
	})

	test("Enter on an empty draft sends nothing", () => {
		Scene.scene(
			config(),
			Scene.given(fresh()),
			dropZoneIdle,
			editorReports(Composer.Message.SubmittedDraft({ markdown: "" })),
			Scene.Command.expectNone(),
		)
	})

	test("Enter while editing saves the edit and leaves edit mode", () => {
		Scene.scene(
			config(),
			Scene.given(editing()),
			dropZoneIdle,
			editorReports(Composer.Message.SubmittedDraft({ markdown: `${lastOwnContent}!` })),
			Scene.expect(editBanner).toBeAbsent(),
			Scene.Command.expectExact(
				EditorCommands.ClearEditor({ editorId }),
				Draft.EditMessage({ messageId: lastOwnId, content: `${lastOwnContent}!` }),
			),
			Scene.Command.resolveAll(
				[EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()],
				[Draft.EditMessage, Draft.Message.SucceededEditMessage()],
			),
		)
	})

	test("Enter on an edit emptied of its text asks to delete the message (Discord)", () => {
		Scene.scene(
			config(),
			Scene.given(editing()),
			dropZoneIdle,
			editorReports(Composer.Message.SubmittedDraft({ markdown: "   " })),
			Scene.expect(editBanner).toBeAbsent(),
			Scene.Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Scene.expectOutMessage(Draft.OutMessage.RequestedDeleteMessage({ messageId: lastOwnId })),
			Scene.Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
		)
	})
})
