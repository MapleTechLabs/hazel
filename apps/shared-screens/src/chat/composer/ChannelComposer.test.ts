// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Story } from "@effect/ui/testing"
import { AttachmentId, ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { OpenModal, ShowToast } from "../../app/requests"
import {
	BlurField,
	ChannelComposerMessage as M,
	ChannelComposerNoDeps,
	DeleteTypingIndicator,
	EditMessage,
	FocusField,
	NotifyHost,
	ReleaseFiles,
	SaveDraft,
	SendMessage,
	SendTypingHeartbeat,
	WaitForHeartbeatInterval,
	WaitForTypingTimeout,
} from "./ChannelComposer"
import { attachmentsOf, canSend, optionsOf, replaceTrigger, type SuggestionData } from "./model"
import * as Typing from "./typing"

const channelId = ChannelId.make("00000000-0000-4000-8000-000000000001")
const ada = UserId.make("00000000-0000-4000-8000-000000000002")
const grace = UserId.make("00000000-0000-4000-8000-000000000003")
const messageId = MessageId.make("00000000-0000-4000-8000-000000001001")
const attachmentId = AttachmentId.make("00000000-0000-4000-8000-000000002001")

const props = {
	channelId,
	organizationId: OrganizationId.make("00000000-0000-4000-8000-000000000009"),
	userId: ada,
	placeholder: "Type a message...",
	ready: true,
	autoFocus: false,
}

/** What the field reports as the user types `value` over the Model's latest edit. */
const typed = (value: string, rev: number, edit = 0) => M.ChangedDraft({ payload: { value, rev, edit } })
const submitted = (value: string, rev: number, edit = 0) =>
	M.SubmittedDraft({ payload: { value, rev, edit } })

type Ran = ReadonlyArray<{ readonly name: string; readonly args: unknown }>

const sendArgs = (ran: Ran) =>
	ran.findLast((entry) => entry.name === SendMessage.key)?.args as
		| {
				readonly content: string
				readonly replyToMessageId: string | null
				readonly attachmentIds: ReadonlyArray<string>
		  }
		| undefined

/** Silent effects (saving the draft, focus, toasts, modals) settle at once; the rest stay pending. */
const SILENT = [
	SaveDraft,
	FocusField,
	BlurField,
	ReleaseFiles,
	NotifyHost,
	ShowToast,
	OpenModal,
	DeleteTypingIndicator,
]
const KEPT = [SendTypingHeartbeat, WaitForHeartbeatInterval, WaitForTypingTimeout]

/** A composer story whose `send` records what each message ran (`ran`) and settles it. */
const make = (overrides: Partial<typeof props> = {}) =>
	Effect.map(Story.make(ChannelComposerNoDeps, { ...props, ...overrides }), (s) => {
		const ran: Array<{ readonly name: string; readonly args: unknown }> = []
		const kept = new Set<unknown>()
		/** Records and settles what is pending, sends succeeding, until nothing new runs. */
		const settle = (): void => {
			for (const entry of s.pending) {
				if (kept.has(entry.command)) continue
				ran.push({ name: entry.command.name, args: entry.command.args })
				const silent = SILENT.find((command) => command.key === entry.command.name)
				if (silent !== undefined) s.resolve(silent as never, Component.noop as never)
				else if (entry.command.name === SendMessage.key) {
					const { uploads } = entry.command.args as {
						readonly uploads: ReadonlyArray<{ localId: string }>
					}
					s.resolve(
						SendMessage,
						M.SucceededSendMessage({ localIds: uploads.map((upload) => upload.localId) }),
					)
					return settle()
				} else if (entry.command.name === EditMessage.key)
					s.resolve(EditMessage, M.SucceededEditMessage())
				else {
					const keep = KEPT.find((command) => command.key === entry.command.name)
					if (keep !== undefined) s.keepPending(keep as never)
					kept.add(entry.command)
				}
			}
		}
		const send = (message: M): void => {
			s.send(message)
			settle()
		}
		return { s, ran, send }
	})

describe("ChannelComposer", () => {
	it.effect("Enter sends the text and clears the field", () =>
		Effect.gen(function* () {
			const { s, ran, send } = yield* make()
			send(typed("Shipping today", 1))
			send(submitted("Shipping today", 1))
			assert.strictEqual(sendArgs(ran)?.content, "Shipping today")
			assert.isNull(sendArgs(ran)?.replyToMessageId ?? null)
			assert.strictEqual(s.model.draft.text, "")
		}),
	)

	it.effect("a reply from the page shows its bar and goes with the send; the bar's close cancels it", () =>
		Effect.gen(function* () {
			const { s, ran, send } = yield* make()
			const reply = M.ReceivedRequest({
				request: { _tag: "Reply", messageId, author: "Grace", text: "Launch confirmed" },
			})
			send(reply)
			assert.deepStrictEqual(s.model.mode, {
				_tag: "Replying",
				messageId,
				author: "Grace",
				text: "Launch confirmed",
			})
			send(M.CancelledContext())
			assert.strictEqual(s.model.mode._tag, "Plain")
			send(reply)
			send(typed("On it", 1))
			send(submitted("On it", 1))
			assert.strictEqual(sendArgs(ran)?.replyToMessageId, messageId)
			assert.strictEqual(s.model.mode._tag, "Plain")
		}),
	)

	it.effect("Up in the empty field edits the last own message; emptied, Enter asks to delete it", () =>
		Effect.gen(function* () {
			const { s, ran, send } = yield* make()
			send(M.UpdatedLastOwn({ last: { id: messageId, content: "Shipped the copy" } }))
			send(M.PressedEditLast())
			assert.deepStrictEqual(s.model.mode, { _tag: "Editing", messageId, hadText: true })
			assert.strictEqual(s.model.draft.text, "Shipped the copy")
			send(typed("", 1, s.model.draft.edit))
			send(submitted("", 1, s.model.draft.edit))
			assert.isTrue(ran.some((entry) => entry.name === OpenModal.key))
			assert.strictEqual(s.model.mode._tag, "Plain")
		}),
	)

	it.effect("a picked @ suggestion becomes a mention atom in place of the query", () =>
		Effect.gen(function* () {
			const { s, send } = yield* make()
			send(
				M.UpdatedMembers({
					members: [{ userId: grace, name: "Grace Hopper", avatarUrl: null, provider: null }],
				}),
			)
			send(typed("thanks @gr", 1))
			send(M.ChangedTrigger({ kind: "@", query: "gr" }))
			send(M.PressedSuggestionKey({ key: "enter" }))
			assert.strictEqual(s.model.draft.text, `thanks @[userId:${grace}] `)
			assert.isNull(s.model.trigger)
		}),
	)

	it.effect("files upload one after another with progress; a failed one offers retry", () =>
		Effect.gen(function* () {
			const { s, ran, send } = yield* make()
			const file = (localId: string) => ({
				localId,
				name: `${localId}.pdf`,
				size: 2048,
				kind: "file" as const,
				preview: null,
			})
			send(M.AddedFiles({ files: [file("a"), file("b")] }))
			assert.isFalse(canSend("", s.model.uploads))
			send(M.ReceivedUploadEvent({ localId: "a", event: { _tag: "Progressed", progress: 0.5 } }))
			assert.strictEqual(attachmentsOf(s.model.uploads)[0]?.progress, 0.5)
			send(M.ReceivedUploadEvent({ localId: "a", event: { _tag: "Uploaded", attachmentId } }))
			send(M.ReceivedUploadEvent({ localId: "b", event: { _tag: "Failed", reason: "Network" } }))
			assert.isTrue(attachmentsOf(s.model.uploads)[1]?.failed)
			assert.isTrue(canSend("", s.model.uploads))
			send(M.PressedRetryAttachment({ id: "b" }))
			assert.isFalse(s.model.uploads[1]?.failed)
			send(M.PressedRemoveAttachment({ id: "b" }))
			send(submitted("", 0))
			assert.deepStrictEqual(sendArgs(ran)?.attachmentIds, [attachmentId])
		}),
	)

	it.effect("a thread still being created holds the send, the text staying in the field", () =>
		Effect.gen(function* () {
			const { s, ran, send } = yield* make({ ready: false })
			send(typed("first reply", 1))
			send(submitted("first reply", 1))
			assert.isUndefined(sendArgs(ran))
			assert.deepStrictEqual(s.model.held, [{ _tag: "Send", text: "first reply" }])
			assert.strictEqual(s.model.draft.text, "first reply")
		}),
	)
})

describe("composer rules", () => {
	const data: SuggestionData = {
		members: [{ userId: grace, name: "Grace Hopper", avatarUrl: null, provider: null }],
		bots: [],
		groups: [{ id: "g1", handle: "design", name: "Design", memberCount: 3 }],
		presence: [{ userId: grace, status: "online" }],
		commands: [],
		customEmojis: [{ name: "shipit", imageUrl: "https://cdn.test/emojis/shipit.png" }],
	}

	it("@ lists directives, groups, then members, filtered", () => {
		assert.deepStrictEqual(
			optionsOf({ kind: "@", query: "" }, data).map((option) => option.suggestion.label),
			["@channel", "@here", "@design", "Grace Hopper"],
		)
		assert.deepStrictEqual(
			optionsOf({ kind: "@", query: "gra" }, data).map((option) => option.suggestion.face?.presence),
			["online"],
		)
	})

	it(": needs two letters, custom emojis first", () => {
		assert.deepStrictEqual(optionsOf({ kind: ":", query: "s" }, data), [])
		assert.strictEqual(optionsOf({ kind: ":", query: "sh" }, data)[0]?.suggestion.label, ":shipit:")
	})

	it("replaces the trigger at a word start only", () => {
		assert.strictEqual(
			replaceTrigger("mail@x and @x", { kind: "@", query: "x" }, "@[userId:u] "),
			"mail@x and @[userId:u] ",
		)
	})

	it("typing heartbeats once per interval and names only fresh others", () => {
		const first = Typing.contentChanged(Typing.initialTyping, "h", true)
		assert.deepStrictEqual(
			first.effects.map((effect) => effect._tag),
			["Heartbeat", "WaitInterval", "WaitTimeout"],
		)
		const second = Typing.contentChanged(first.state, "hi", true)
		assert.deepStrictEqual(
			second.effects.map((effect) => effect._tag),
			["WaitTimeout"],
		)
		assert.deepStrictEqual(
			Typing.typingNamesOf(
				[
					{ name: "Grace", isSelf: false, lastTypedMs: 10_000 },
					{ name: "Ada", isSelf: true, lastTypedMs: 10_000 },
					{ name: "Alan", isSelf: false, lastTypedMs: 1_000 },
				],
				12_000,
			),
			["Grace"],
		)
	})
})
