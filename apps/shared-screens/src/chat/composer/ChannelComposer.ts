// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel composer (today's `web-foldkit/src/composer/`): the hazel `composer` with its draft
 * kept per channel, reply and edit context, Up to edit the last message, `@ / :` suggestions, a `/`
 * command's arguments, attachments uploaded one after another with progress and retry, the drop
 * zone while files are dragged over the page, the typing heartbeat and who else is typing, and the
 * emoji and GIF pickers. A thread's composer holds what it sends until its thread exists (`ready`).
 */
import { Command, Component, Renderer, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { CreateTypingIndicatorPayload } from "@hazel/domain/rpc"
import { AttachmentId, ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { type Content, Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { ComposerKey } from "@hazel/ui/vocabulary/options"
import { Clock, Duration, Effect, Layer, Option, Schedule, Schema, Stream } from "effect"
import { type AppToast, OpenModal, ShowToast } from "../../app/requests"
import { EmojiPicker } from "../pickers/EmojiPicker"
import { GifPicker } from "../pickers/GifPicker"
import {
	botsStream,
	commandsStream,
	customEmojisStream,
	groupsStream,
	lastOwnStream,
	membersStream,
	membershipStream,
	presenceStream,
	typingStream,
} from "./data"
import {
	BotCommandFailure,
	BotCommands,
	ComposerFiles,
	ComposerHost,
	ComposerRequest,
	Drafts,
	SavedDraft,
	UploadEvent,
	UploadFailure,
} from "./host"
import {
	activeOf,
	appendText,
	attachmentIdsOf,
	attachmentsOf,
	BotCommand,
	CommandInput,
	CustomEmoji,
	canSend,
	currentUpload,
	emptyTextOf,
	HeldFile,
	isUploading,
	MentionBot,
	MentionGroup,
	MentionMember,
	missingArguments,
	Mode,
	optionsOf,
	pickedEmojiMarkdown,
	plain,
	Presence,
	replaceTrigger,
	stepActive,
	Trigger,
	Upload,
	uploadOf,
} from "./model"
import * as Typing from "./typing"

export const ChannelComposerProps = Schema.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	userId: UserId,
	placeholder: Schema.String,
	/** False while a thread is still being created: sends and uploads wait for it. */
	ready: Schema.Boolean,
	/** Take the focus once mounted (a thread panel just opened). */
	autoFocus: Schema.Boolean,
})
export type ChannelComposerProps = typeof ChannelComposerProps.Type

/** What waits for the thread to exist. */
const Held = Schema.Union([
	Schema.TaggedStruct("Send", { text: Schema.String }),
	Schema.TaggedStruct("Gif", { url: Schema.String }),
])
type Held = typeof Held.Type

const TypingRow = Schema.Struct({ name: Schema.String, isSelf: Schema.Boolean, lastTypedMs: Schema.Finite })

export const Picker = Schema.Literals(["none", "emoji", "gif"])

export const ChannelComposerModel = Schema.Struct({
	draft: TextField.State,
	mode: Mode,
	uploads: Schema.Array(Upload),
	trigger: Schema.NullOr(Trigger),
	active: Schema.NullOr(Schema.String),
	command: Schema.NullOr(CommandInput),
	/** Each argument field's text, by argument name. */
	fields: Schema.Record(Schema.String, TextField.State),
	picker: Picker,
	held: Schema.Array(Held),
	dragging: Schema.Boolean,
	members: Schema.Array(MentionMember),
	bots: Schema.Array(MentionBot),
	groups: Schema.Array(MentionGroup),
	presence: Schema.Array(Presence),
	commands: Schema.Array(BotCommand),
	customEmojis: Schema.Array(CustomEmoji),
	memberId: Schema.NullOr(ChannelMemberId),
	lastOwn: Schema.NullOr(Schema.Struct({ id: MessageId, content: Schema.String })),
	typing: Typing.TypingState,
	others: Schema.Array(TypingRow),
	nowMs: Schema.Finite,
})
export type ChannelComposerModel = typeof ChannelComposerModel.Type

/** Why a send failed. `SyncDelayed`: it was delivered, the sync lags. */
const SendFailure = Schema.Literals(["ChannelNotFound", "SyncDelayed", "Unavailable"])

export const ChannelComposerMessage = UiSchema.TaggedEnum({
	ChangedDraft: { payload: TextField.ChangePayload },
	SubmittedDraft: { payload: TextField.ChangePayload },
	ChangedTrigger: { kind: Trigger.fields.kind, query: Schema.NullOr(Schema.String) },
	PressedSuggestionKey: { key: ComposerKey },
	PressedSuggestion: { id: Schema.String },
	HoveredSuggestion: { id: Schema.String },
	PressedEditLast: {},
	CancelledContext: {},
	PressedEscape: {},
	LeftComposer: {},
	DroppedFiles: {},
	PressedAttach: {},
	AddedFiles: { files: Schema.Array(HeldFile) },
	PressedRemoveAttachment: { id: Schema.String },
	PressedRetryAttachment: { id: Schema.String },
	ReceivedUploadEvent: { localId: Schema.String, event: UploadEvent },
	PressedEmoji: {},
	PressedGif: {},
	PickedEmojiPickerEmoji: { emoji: Schema.String },
	RequestedCloseEmojiPicker: {},
	PickedGifPickerGif: { url: Schema.String },
	RequestedCloseGifPicker: {},
	ChangedCommandField: { name: Schema.String, payload: TextField.ChangePayload },
	PressedExecuteCommand: {},
	PressedCancelCommand: {},
	SucceededSendMessage: { localIds: Schema.Array(Schema.String) },
	FailedSendMessage: {
		text: Schema.String,
		mode: Mode,
		uploads: Schema.Array(Upload),
		restore: Schema.Boolean,
		reason: SendFailure,
	},
	SucceededEditMessage: {},
	FailedEditMessage: {},
	SucceededExecuteBotCommand: { name: Schema.String },
	FailedExecuteBotCommand: { name: Schema.String, botName: Schema.String, reason: BotCommandFailure },
	SucceededSendTypingHeartbeat: { sessionId: Schema.Finite, indicator: Typing.Indicator },
	FailedSendTypingHeartbeat: {},
	CompletedWaitForHeartbeatInterval: { version: Schema.Finite },
	CompletedWaitForTypingTimeout: { version: Schema.Finite },
	RestoredDraft: { draft: Schema.NullOr(SavedDraft) },
	ReceivedRequest: { request: ComposerRequest },
	ChangedDragging: { dragging: Schema.Boolean },
	ReleasedHeld: {},
	Mounted: {},
	UpdatedMembers: { members: Schema.Array(MentionMember) },
	UpdatedBots: { bots: Schema.Array(MentionBot) },
	UpdatedGroups: { groups: Schema.Array(MentionGroup) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedCommands: { commands: Schema.Array(BotCommand) },
	UpdatedCustomEmojis: { emojis: Schema.Array(CustomEmoji) },
	UpdatedMembership: { memberId: Schema.NullOr(ChannelMemberId) },
	UpdatedLastOwn: { last: Schema.NullOr(Schema.Struct({ id: MessageId, content: Schema.String })) },
	UpdatedTyping: { typing: Schema.Array(TypingRow) },
	Ticked: { nowMs: Schema.Finite },
})
export type ChannelComposerMessage = typeof ChannelComposerMessage.Type
const M = ChannelComposerMessage

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

/** The field, so a Command can focus it and place the caret. */
export const FieldRef = Renderer.ref("ChannelComposer.field")

const withField = (
	host: Hazel.Host["Service"],
	act: (host: Hazel.Host["Service"], node: Hazel.HostNode) => Effect.Effect<void>,
) =>
	Effect.gen(function* () {
		// After the render that draws the change: the field takes its new text first.
		yield* Effect.sleep("16 millis")
		const refs = yield* Renderer.Refs
		const node = yield* refs.lookup(FieldRef)
		// SAFETY: a ref resolves to the node its host created (`Hazel.HostNode`).
		if (Option.isSome(node)) yield* act(host, node.value as Hazel.HostNode)
		return Component.noop
	})

/** Focuses the field with the caret at its end (`focusAtEnd`). */
export class FocusField extends Command.Service<FocusField>()("hazel/composer/FocusField", {
	args: { end: Schema.Finite },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(Hazel.Host),
			(host) =>
				({ end }) =>
					withField(host, (host, node) => host.select(node, { start: end, end })),
		),
	)
}

/** Takes the focus off the field (Shift+Tab: the page moves it to the messages). */
export class BlurField extends Command.Service<BlurField>()("hazel/composer/BlurField", {
	args: {},
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(Hazel.Host),
			(host) => () => withField(host, (host, node) => host.blur(node)),
		),
	)
}

export class PickFiles extends Command.Service<PickFiles>()("hazel/composer/PickFiles", {
	args: {},
	success: ChannelComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(ComposerFiles),
			(files) => () => Effect.map(files.pick, (picked) => M.AddedFiles({ files: picked })),
		),
	)
}

export class TakeDroppedFiles extends Command.Service<TakeDroppedFiles>()("hazel/composer/TakeDroppedFiles", {
	args: {},
	success: ChannelComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(ComposerFiles),
			(files) => () => Effect.map(files.dropped, (dropped) => M.AddedFiles({ files: dropped })),
		),
	)
}

export class ReleaseFiles extends Command.Service<ReleaseFiles>()("hazel/composer/ReleaseFiles", {
	args: { localIds: Schema.Array(Schema.String) },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(ComposerFiles),
			(files) =>
				({ localIds }) =>
					Effect.forEach(localIds, files.release, { discard: true }).pipe(
						Effect.as(Component.noop),
					),
		),
	)
}

export class SaveDraft extends Command.Service<SaveDraft>()("hazel/composer/SaveDraft", {
	args: { channelId: ChannelId, draft: SavedDraft },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(Drafts),
			(drafts) =>
				({ channelId, draft }) =>
					Effect.sync(() => {
						drafts.write(channelId, draft)
						return Component.noop
					}),
		),
	)
}

/** Tells the page around the composer (scroll to the end, mark read, focus the messages). */
export class NotifyHost extends Command.Service<NotifyHost>()("hazel/composer/NotifyHost", {
	args: { notice: Schema.Unknown },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(ComposerHost),
			(host) =>
				({ notice }) =>
					host.notify(notice as Parameters<typeof host.notify>[0]).pipe(Effect.as(Component.noop)),
		),
	)
}

const sendFailureOf = (error: unknown): typeof SendFailure.Type => {
	const tag = typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined
	return tag === "ChannelNotFoundError"
		? "ChannelNotFound"
		: tag === "SyncError"
			? "SyncDelayed"
			: "Unavailable"
}

/** `sendMessageAction` (optimistic): the row shows at once and rolls back if the server refuses. */
export class SendMessage extends Command.Service<SendMessage>()("hazel/composer/SendMessage", {
	args: {
		channelId: ChannelId,
		authorId: UserId,
		content: Schema.String,
		replyToMessageId: Schema.NullOr(MessageId),
		attachmentIds: Schema.Array(AttachmentId),
		mode: Mode,
		uploads: Schema.Array(Upload),
		restore: Schema.Boolean,
	},
	success: ChannelComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ mode, uploads, restore, ...variables }) =>
				data.actions
					.sendMessageAction({
						...variables,
						threadChannelId: null,
						attachmentIds: [...variables.attachmentIds],
					})
					.pipe(
						Effect.provideService(HazelRpc, rpc),
						Effect.match({
							onSuccess: () =>
								M.SucceededSendMessage({ localIds: uploads.map((upload) => upload.localId) }),
							// BOUNDARY: every refusal ends here; the reason picks the toast.
							onFailure: (error) =>
								M.FailedSendMessage({
									text: variables.content,
									mode,
									uploads,
									restore,
									reason: sendFailureOf(error),
								}),
						}),
					)
		}),
	)
}

export class EditMessage extends Command.Service<EditMessage>()("hazel/composer/EditMessage", {
	args: { messageId: MessageId, content: Schema.String },
	success: ChannelComposerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return (args) =>
				data.actions.editMessageAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.match({
						onSuccess: () => M.SucceededEditMessage(),
						onFailure: () => M.FailedEditMessage(),
					}),
				)
		}),
	)
}

export class ExecuteBotCommand extends Command.Service<ExecuteBotCommand>()(
	"hazel/composer/ExecuteBotCommand",
	{
		args: {
			orgId: OrganizationId,
			botId: BotCommand.fields.botId,
			commandName: Schema.String,
			botName: Schema.String,
			channelId: ChannelId,
			arguments: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
		},
		success: ChannelComposerMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(BotCommands),
			(bots) =>
				({ botName, ...args }) =>
					bots.execute(args).pipe(
						Effect.match({
							onSuccess: () => M.SucceededExecuteBotCommand({ name: args.commandName }),
							onFailure: (reason) =>
								M.FailedExecuteBotCommand({ name: args.commandName, botName, reason }),
						}),
					),
		),
	)
}

export class SendTypingHeartbeat extends Command.Service<SendTypingHeartbeat>()(
	"hazel/composer/SendTypingHeartbeat",
	{
		args: { channelId: ChannelId, memberId: ChannelMemberId, sessionId: Schema.Finite },
		success: ChannelComposerMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ channelId, memberId, sessionId }) =>
					Effect.gen(function* () {
						const lastTyped = yield* Clock.currentTimeMillis
						const response = yield* rpc(
							"typingIndicator.create",
							new CreateTypingIndicatorPayload({ channelId, memberId, lastTyped }),
						)
						return M.SucceededSendTypingHeartbeat({
							sessionId,
							indicator: { id: response.data.id, channelId },
						})
					}).pipe(
						// BOUNDARY: a lost heartbeat only means the indicator shows a little later.
						Effect.catchCause(() => Effect.succeed(M.FailedSendTypingHeartbeat())),
					),
		),
	)
}

/** `typingIndicator.delete`; a failure is ignored (the server expires the indicator anyway). */
const deleteIndicator = (rpc: HazelRpc["Service"], indicator: Typing.Indicator) =>
	rpc("typingIndicator.delete", indicator).pipe(Effect.ignore)

export class DeleteTypingIndicator extends Command.Service<DeleteTypingIndicator>()(
	"hazel/composer/DeleteTypingIndicator",
	{ args: Typing.Indicator.fields, success: Component.Noop },
) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) => (indicator) => deleteIndicator(rpc, indicator).pipe(Effect.as(Component.noop)),
		),
	)
}

export class WaitForHeartbeatInterval extends Command.Service<WaitForHeartbeatInterval>()(
	"hazel/composer/WaitForHeartbeatInterval",
	{ args: { version: Schema.Finite }, success: ChannelComposerMessage },
) {
	static readonly layer = this.toLayer(
		Effect.succeed(({ version }) =>
			Effect.sleep(Duration.millis(Typing.HEARTBEAT_INTERVAL_MS)).pipe(
				Effect.as(M.CompletedWaitForHeartbeatInterval({ version })),
			),
		),
	)
}

export class WaitForTypingTimeout extends Command.Service<WaitForTypingTimeout>()(
	"hazel/composer/WaitForTypingTimeout",
	{ args: { version: Schema.Finite }, success: ChannelComposerMessage },
) {
	static readonly layer = this.toLayer(
		Effect.succeed(({ version }) =>
			Effect.sleep(Duration.millis(Typing.TYPING_TIMEOUT_MS)).pipe(
				Effect.as(M.CompletedWaitForTypingTimeout({ version })),
			),
		),
	)
}

// ---------------------------------------------------------------------------
// update helpers
// ---------------------------------------------------------------------------

type Model = ChannelComposerModel
type Props = ChannelComposerProps
type Step = Command.Command<ChannelComposerMessage | Component.Noop, any>

const toast = (intent: AppToast["intent"], title: string, description: string | null = null) =>
	ShowToast.make({ toast: { intent, title, description } })

const dataOf = (model: Model) => ({
	members: model.members,
	bots: model.bots,
	groups: model.groups,
	presence: model.presence,
	commands: model.commands,
	customEmojis: model.customEmojis,
})

/** The heartbeat steps as Commands; a stop's delete is the cleanup Subscription's. */
const typingCommands = (props: Props, model: Model, step: Typing.TypingStep): ReadonlyArray<Step> =>
	step.effects.flatMap((effect): ReadonlyArray<Step> => {
		switch (effect._tag) {
			case "Heartbeat":
				return model.memberId === null
					? []
					: [
							SendTypingHeartbeat.make({
								channelId: props.channelId,
								memberId: model.memberId,
								sessionId: effect.sessionId,
							}),
						]
			case "WaitInterval":
				return [WaitForHeartbeatInterval.make({ version: effect.version })]
			case "WaitTimeout":
				return [WaitForTypingTimeout.make({ version: effect.version })]
			case "Delete":
				return effect.indicator.id === model.typing.indicator?.id
					? []
					: [DeleteTypingIndicator.make(effect.indicator)]
		}
	})

const save = (props: Props, text: string, mode: Mode) =>
	SaveDraft.make({ channelId: props.channelId, draft: { text, mode } })

const reasonText = (reason: UploadFailure) =>
	reason === "TooLarge"
		? { title: "File too large", description: "File size exceeds 10MB limit" }
		: reason === "Unsupported"
			? { title: "Unsupported file type", description: null }
			: reason === "Rejected"
				? { title: "Upload failed", description: "Failed to get upload URL. Please try again." }
				: reason === "Network"
					? { title: "Upload failed", description: "Network error. Please check your connection." }
					: { title: "Upload failed", description: "Failed to finalize upload. Please try again." }

const botCommandText = (reason: BotCommandFailure, name: string, botName: string) =>
	reason === "BotNotFound"
		? { title: `Bot "${botName}" was not found`, description: null }
		: reason === "BotNotInstalled"
			? { title: `Bot "${botName}" is not installed`, description: null }
			: reason === "CommandNotFound"
				? { title: `Command /${name} not found`, description: null }
				: reason === "ExecutionFailed"
					? {
							title: `/${name} failed`,
							description: "The bot reported an error running the command.",
						}
					: { title: "Service temporarily unavailable", description: null }

/** The longest excerpt of a failed message a toast quotes. */
const EXCERPT = 80

const notSent = (text: string) => {
	const flat = text.trim().replace(/\s+/g, " ")
	const excerpt = flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat
	return excerpt === "" ? "Your message wasn't sent." : `Your message “${excerpt}” wasn't sent.`
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** A step of this component's update; helpers read `s.model`, the Model so far. */
type S = Component.Step<ChannelComposerModel, ChannelComposerMessage, never, any>

const emptyCommand = { command: null, fields: {} }

/** `setEditingMessageId`: the message's text into the field, the edit bar over it. */
const startEditing = (s: S, props: Props, messageId: MessageId, content: string): S => {
	const mode: Mode = { _tag: "Editing", messageId, hadText: content.trim() !== "" }
	return s
		.evolve({ mode, draft: TextField.set(s.model.draft, content) })
		.run(save(props, content, mode), FocusField.make({ end: content.length }))
}

/** Out now: the text, the reply and the uploaded files; the draft clears, the typing stops. */
const sendNow = (s: S, props: Props, content: string): S => {
	const model = s.model
	const stopped = Typing.stop(model.typing)
	const sent = model.uploads.filter((upload) => upload.attachmentId !== null)
	return s
		.evolve({
			draft: TextField.set(model.draft, ""),
			mode: plain,
			uploads: (all) => all.filter((upload) => upload.attachmentId === null),
			typing: stopped.state,
			trigger: null,
		})
		.run(
			...typingCommands(props, model, stopped),
			save(props, "", plain),
			SendMessage.make({
				channelId: props.channelId,
				authorId: props.userId,
				content,
				replyToMessageId: model.mode._tag === "Replying" ? model.mode.messageId : null,
				attachmentIds: attachmentIdsOf(sent),
				mode: model.mode,
				uploads: sent,
				restore: true,
			}),
		)
}

/** `handleGifSelect`: the GIF's url as a message of its own; it answers a reply, an edit stays. */
const sendGif = (s: S, props: Props, url: string): S => {
	if (!props.ready) return s.evolve({ held: (all) => [...all, { _tag: "Gif" as const, url }] })
	const model = s.model
	const sent = model.uploads.filter((upload) => upload.attachmentId !== null)
	const replying = model.mode._tag === "Replying" ? model.mode : null
	return s
		.evolve({
			mode: replying === null ? model.mode : plain,
			uploads: (all) => all.filter((upload) => upload.attachmentId === null),
		})
		.run(
			SendMessage.make({
				channelId: props.channelId,
				authorId: props.userId,
				content: url,
				replyToMessageId: replying?.messageId ?? null,
				attachmentIds: attachmentIdsOf(sent),
				mode: replying ?? plain,
				uploads: sent,
				restore: false,
			}),
		)
}

/** `handleCommandExecute`: the required arguments, then the bot command, one run at a time. */
const executeCommand = (s: S, props: Props): S => {
	const input = s.model.command
	if (input === null || input.executing) return s
	const values = Object.fromEntries(
		input.command.arguments.map((arg) => [arg.name, s.model.fields[arg.name]?.text ?? ""]),
	)
	const missing = missingArguments({ ...input, values })
	if (missing.length > 0) return s.run(toast("error", `Missing required: ${missing.join(", ")}`))
	return s.evolve({ command: { ...input, values, executing: true } }).run(
		ExecuteBotCommand.make({
			orgId: props.organizationId,
			botId: input.command.botId,
			commandName: input.command.name,
			botName: input.command.botName,
			channelId: props.channelId,
			arguments: Object.entries(values)
				.filter(([, value]) => value.trim() !== "")
				.map(([name, value]) => ({ name, value })),
		}),
	)
}

/** `handleSubmit`: an edit (emptied, it asks to delete), a send, or nothing while a file uploads. */
const submit = (s: S, props: Props, raw: string): S => {
	const model = s.model
	const content = raw.trim()
	if (model.command !== null) return executeCommand(s, props)
	if (isUploading(model.uploads)) return s
	if (model.mode._tag === "Editing") {
		const { messageId, hadText } = model.mode
		const left = s
			.evolve({ mode: plain, draft: TextField.set(model.draft, "") })
			.run(save(props, "", plain))
		// An edit emptied of its text deletes the message, once confirmed (Discord).
		if (content === "")
			return hadText ? left.run(OpenModal.make({ modal: { _tag: "DeleteMessage", messageId } })) : s
		return left.run(EditMessage.make({ messageId, content }))
	}
	if (content === "" && attachmentIdsOf(model.uploads).length === 0) return s
	// A thread still being created: the text stays in the field until it can go.
	if (!props.ready) return s.evolve({ held: (all) => [...all, { _tag: "Send" as const, text: content }] })
	return sendNow(s, props, content)
}

/**
 * Plays back what waited for the thread, in order. A send waits while a file before it uploads;
 * one whose text was edited since is dropped (the field shows what will go).
 */
const releaseHeld = (s: S, props: Props): S => {
	let step = s
	for (;;) {
		const [first, ...rest] = step.model.held
		if (first === undefined || !props.ready) return step
		if (first._tag === "Send" && isUploading(step.model.uploads)) return step
		step = step.evolve({ held: rest })
		if (first._tag === "Gif") step = sendGif(step, props, first.url)
		else if (step.model.draft.text.trim() === first.text) step = sendNow(step, props, first.text)
	}
}

/** A suggestion picked: its mention or emoji in place of the trigger, or a command's panel. */
const pick = (s: S, props: Props, id: string): S => {
	const trigger = s.model.trigger
	const option = optionsOf(trigger, dataOf(s.model)).find((each) => each.suggestion.id === id)
	if (trigger === null || option === undefined) return s
	const closed = { trigger: null, active: null }
	if (option.pick._tag === "Command") {
		const text = replaceTrigger(s.model.draft.text, trigger, "")
		return s
			.evolve({
				...closed,
				draft: TextField.set(s.model.draft, text),
				command: { command: option.pick.command, values: {}, executing: false },
				fields: {},
			})
			.run(save(props, text, s.model.mode))
	}
	const text = replaceTrigger(s.model.draft.text, trigger, `${option.pick.markdown} `)
	return s
		.evolve({ ...closed, draft: TextField.set(s.model.draft, text) })
		.run(save(props, text, s.model.mode))
}

// ---------------------------------------------------------------------------
// the component
// ---------------------------------------------------------------------------

export const ChannelComposerNoDeps = Hazel.component({
	name: "ChannelComposer",
	props: ChannelComposerProps,
	model: ChannelComposerModel,
	message: ChannelComposerMessage,
}).make({
	init: () => ({
		draft: TextField.empty,
		mode: plain,
		uploads: [],
		trigger: null,
		active: null,
		command: null,
		fields: {},
		picker: "none" as const,
		held: [],
		dragging: false,
		members: [],
		bots: [],
		groups: [],
		presence: [],
		commands: [],
		customEmojis: [],
		memberId: null,
		lastOwn: null,
		typing: Typing.initialTyping,
		others: [],
		nowMs: 0,
	}),
	update: {
		ChangedDraft: ($, { payload }) => {
			const draft = TextField.changed($.model.draft, payload)
			if (draft === $.model.draft) return $.model
			const step = Typing.contentChanged($.model.typing, draft.text.trim(), $.model.memberId !== null)
			return $.evolve({ draft, typing: step.state })
				.run(...typingCommands($.props, $.model, step))
				.run(save($.props, draft.text, $.model.mode))
		},
		SubmittedDraft: ($, { payload }) => {
			const text = TextField.current($.model.draft, payload) ? payload.value : $.model.draft.text
			return submit($, $.props, text)
		},
		ChangedTrigger: ($, { kind, query }) =>
			$.evolve({ trigger: query === null ? null : { kind, query }, active: null }),
		PressedSuggestionKey: ($, { key }) => {
			const options = optionsOf($.model.trigger, dataOf($.model))
			if (key === "down") return $.evolve({ active: stepActive(options, $.model.active, 1) })
			if (key === "up") return $.evolve({ active: stepActive(options, $.model.active, -1) })
			if (key === "escape") return $.evolve({ trigger: null, active: null })
			const id = activeOf(options, $.model.active)
			return id === undefined ? $.model : pick($, $.props, id)
		},
		PressedSuggestion: ($, { id }) => pick($, $.props, id),
		HoveredSuggestion: ($, { id }) => $.evolve({ active: id }),
		// Up in an empty composer edits the user's last message here.
		PressedEditLast: ($) =>
			$.model.lastOwn === null
				? $.model
				: startEditing($, $.props, $.model.lastOwn.id, $.model.lastOwn.content),
		// The bar's close, or Escape while replying or editing: an edit leaves its text, a reply keeps it.
		CancelledContext: ($) =>
			$.model.mode._tag === "Editing"
				? $.evolve({ mode: plain, draft: TextField.set($.model.draft, "") }).run(
						save($.props, "", plain),
					)
				: $.evolve({ mode: plain }).run(save($.props, $.model.draft.text, plain)),
		PressedEscape: ($) =>
			$.model.command !== null
				? $.evolve(emptyCommand).run(FocusField.make({ end: $.model.draft.text.length }))
				: $.run(NotifyHost.make({ notice: { _tag: "Escaped", channelId: $.props.channelId } })),
		LeftComposer: ($) =>
			$.run(BlurField.make({})).run(
				NotifyHost.make({ notice: { _tag: "Left", channelId: $.props.channelId } }),
			),
		DroppedFiles: ($) => $.run(TakeDroppedFiles.make({})),
		PressedAttach: ($) =>
			currentUpload($.model.uploads) === undefined ? $.run(PickFiles.make({})) : $.model,
		AddedFiles: ($, { files }) =>
			files.length === 0 ? $.model : $.evolve({ uploads: (all) => [...all, ...files.map(uploadOf)] }),
		PressedRemoveAttachment: ($, { id }) =>
			$.evolve({ uploads: (all) => all.filter((upload) => upload.localId !== id) }).run(
				ReleaseFiles.make({ localIds: [id] }),
			),
		PressedRetryAttachment: ($, { id }) =>
			$.evolve({
				uploads: (all) =>
					all.map((upload) =>
						upload.localId === id ? { ...upload, failed: false, progress: 0 } : upload,
					),
			}),
		ReceivedUploadEvent: ($, { localId, event }) => {
			const change = (f: (upload: Upload) => Upload) =>
				$.evolve({
					uploads: (all) => all.map((upload) => (upload.localId === localId ? f(upload) : upload)),
				})
			switch (event._tag) {
				case "Progressed":
					return change((upload) => ({ ...upload, progress: event.progress }))
				case "Uploaded":
					return releaseHeld(
						change((upload) => ({ ...upload, progress: 1, attachmentId: event.attachmentId })),
						$.props,
					)
				case "Failed": {
					const text = reasonText(event.reason)
					// A file the type check refused is no use to retry: it leaves the draft.
					return event.reason === "Unsupported" || event.reason === "TooLarge"
						? $.evolve({ uploads: (all) => all.filter((upload) => upload.localId !== localId) })
								.run(ReleaseFiles.make({ localIds: [localId] }))
								.run(toast("error", text.title, text.description))
						: change((upload) => ({ ...upload, failed: true })).run(
								toast("error", text.title, text.description),
							)
				}
			}
		},
		PressedEmoji: ($) => $.evolve({ picker: $.model.picker === "emoji" ? "none" : "emoji" }),
		PressedGif: ($) => $.evolve({ picker: $.model.picker === "gif" ? "none" : "gif" }),
		PickedEmojiPickerEmoji: ($, { emoji }) => {
			const text = appendText($.model.draft.text, pickedEmojiMarkdown(emoji, $.model.customEmojis))
			// HAZEL-GAP(p4-composer-insert-at-caret): today the emoji goes in at the caret.
			return $.evolve({ picker: "none", draft: TextField.set($.model.draft, text) })
				.run(save($.props, text, $.model.mode))
				.run(FocusField.make({ end: text.length }))
		},
		RequestedCloseEmojiPicker: ($) => $.evolve({ picker: "none" }),
		PickedGifPickerGif: ($, { url }) => sendGif($.evolve({ picker: "none" }), $.props, url),
		RequestedCloseGifPicker: ($) => $.evolve({ picker: "none" }),
		ChangedCommandField: ($, { name, payload }) =>
			$.evolve({
				fields: (fields) => ({
					...fields,
					[name]: TextField.changed(fields[name] ?? TextField.empty, payload),
				}),
			}),
		PressedExecuteCommand: ($) => executeCommand($, $.props),
		PressedCancelCommand: ($) =>
			$.evolve(emptyCommand).run(FocusField.make({ end: $.model.draft.text.length })),
		SucceededSendMessage: ($, { localIds }) =>
			$.run(
				NotifyHost.make({ notice: { _tag: "Sent", channelId: $.props.channelId } }),
				ReleaseFiles.make({ localIds }),
			),
		// Restore what the optimistic send cleared, then toast; a delayed sync was delivered.
		FailedSendMessage: ($, { text, mode, uploads, restore, reason }) => {
			if (reason === "SyncDelayed")
				return $.run(
					toast("warning", "Message sent", "Sync is delayed but your message was delivered."),
				)
			const title =
				reason === "ChannelNotFound" ? "Channel not found" : "Service temporarily unavailable"
			if (!restore || $.model.draft.text !== "") return $.run(toast("error", title, notSent(text)))
			return $.evolve({
				draft: TextField.set($.model.draft, text),
				mode,
				uploads: (all) => [...uploads, ...all],
			})
				.run(save($.props, text, mode))
				.run(
					toast(
						"error",
						title,
						reason === "ChannelNotFound" ? "This channel may have been deleted." : null,
					),
				)
		},
		// The optimistic edit already shows.
		SucceededEditMessage: ($) => $.model,
		FailedEditMessage: ($) =>
			$.run(toast("error", "Message not found", "This message may have been deleted.")),
		// Success leaves the argument panel and focuses the field; a failure keeps the panel.
		SucceededExecuteBotCommand: ($, { name }) =>
			$.evolve(emptyCommand)
				.run(toast("success", `Executed /${name}`))
				.run(FocusField.make({ end: $.model.draft.text.length })),
		FailedExecuteBotCommand: ($, { name, botName, reason }) => {
			const text = botCommandText(reason, name, botName)
			return $.evolve({
				command: (input) => (input === null ? null : { ...input, executing: false }),
			}).run(toast("error", text.title, text.description))
		},
		SucceededSendTypingHeartbeat: ($, { sessionId, indicator }) => {
			const step = Typing.heartbeatSucceeded($.model.typing, sessionId, indicator)
			return $.evolve({ typing: step.state }).run(...typingCommands($.props, $.model, step))
		},
		FailedSendTypingHeartbeat: ($) => $.model,
		CompletedWaitForHeartbeatInterval: ($, { version }) =>
			$.evolve({ typing: Typing.intervalPassed($.model.typing, version).state }),
		CompletedWaitForTypingTimeout: ($, { version }) =>
			$.evolve({ typing: Typing.timeoutPassed($.model.typing, version).state }),
		RestoredDraft: ($, { draft }) =>
			draft === null || $.model.draft.text !== ""
				? $.model
				: $.evolve({ draft: TextField.set($.model.draft, draft.text), mode: draft.mode }),
		ReceivedRequest: ($, { request }) => {
			switch (request._tag) {
				case "Reply":
					return $.evolve({
						mode: {
							_tag: "Replying",
							messageId: request.messageId,
							author: request.author,
							text: request.text,
						},
					})
						.run(save($.props, $.model.draft.text, $.model.mode))
						.run(FocusField.make({ end: $.model.draft.text.length }))
				case "Edit":
					return startEditing($, $.props, request.messageId, request.content)
				case "Focus":
					return $.run(FocusField.make({ end: $.model.draft.text.length }))
				case "InsertText": {
					if ($.model.command !== null) return $.model
					const text = `${$.model.draft.text}${request.text}`
					return $.evolve({ draft: TextField.set($.model.draft, text) })
						.run(save($.props, text, $.model.mode))
						.run(FocusField.make({ end: text.length }))
				}
				case "AddFiles":
					return $.evolve({ uploads: (all) => [...all, ...request.files.map(uploadOf)] })
				case "OpenEmojiPicker":
					return $.evolve({ picker: "emoji" })
				case "OpenGifPicker":
					return $.evolve({ picker: "gif" })
				case "Attach":
					return currentUpload($.model.uploads) === undefined ? $.run(PickFiles.make({})) : $.model
			}
		},
		ChangedDragging: ($, { dragging }) => $.evolve({ dragging }),
		ReleasedHeld: ($) => releaseHeld($, $.props),
		Mounted: ($) =>
			$.props.autoFocus ? $.run(FocusField.make({ end: $.model.draft.text.length })) : $.model,
		UpdatedMembers: ($, { members }) => $.evolve({ members }),
		UpdatedBots: ($, { bots }) => $.evolve({ bots }),
		UpdatedGroups: ($, { groups }) => $.evolve({ groups }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence }),
		UpdatedCommands: ($, { commands }) => $.evolve({ commands }),
		UpdatedCustomEmojis: ($, { emojis }) => $.evolve({ customEmojis: emojis }),
		UpdatedMembership: ($, { memberId }) => $.evolve({ memberId }),
		UpdatedLastOwn: ($, { last }) => $.evolve({ lastOwn: last }),
		UpdatedTyping: ($, { typing }) => $.evolve({ others: typing }),
		Ticked: ($, { nowMs }) => $.evolve({ nowMs }),
	},
	subscriptions: ({ props, model }) => {
		const upload = props.ready ? currentUpload(model.uploads) : undefined
		const indicator = model.typing.indicator
		const anyoneTyping = model.others.some((row) => !row.isSelf)
		return [
			Subscription.make("restore", [props.channelId], ([channelId]) =>
				Stream.fromEffect(
					Effect.map(Effect.service(Drafts), (drafts) =>
						M.RestoredDraft({ draft: drafts.read(ChannelId.make(channelId)) ?? null }),
					),
				),
			),
			Subscription.make("mounted", [], () => Stream.succeed(M.Mounted())),
			Subscription.make("requests", [props.channelId], ([channelId]) =>
				Stream.unwrap(
					Effect.map(Effect.service(ComposerHost), (host) =>
						host
							.requests(ChannelId.make(channelId))
							.pipe(Stream.map((request) => M.ReceivedRequest({ request }))),
					),
				),
			),
			Subscription.make("dragging", [], () =>
				Stream.unwrap(
					Effect.map(Effect.service(ComposerHost), (host) =>
						host.dragging.pipe(
							Stream.changes,
							Stream.map((dragging) => M.ChangedDragging({ dragging })),
						),
					),
				),
			),
			Subscription.make("members", [props.channelId], ([channelId]) =>
				membersStream(ChannelId.make(channelId), (members) => M.UpdatedMembers({ members })),
			),
			Subscription.make("bots", [props.organizationId], ([organizationId]) =>
				botsStream(OrganizationId.make(organizationId), (bots) => M.UpdatedBots({ bots })),
			),
			Subscription.make("groups", [props.organizationId], ([organizationId]) =>
				groupsStream(OrganizationId.make(organizationId), (groups) => M.UpdatedGroups({ groups })),
			),
			Subscription.make("presence", [], () =>
				presenceStream((presence) => M.UpdatedPresence({ presence })),
			),
			Subscription.make("commands", [props.organizationId], ([organizationId]) =>
				commandsStream(OrganizationId.make(organizationId), (commands) =>
					M.UpdatedCommands({ commands }),
				),
			),
			Subscription.make("customEmojis", [props.organizationId], ([organizationId]) =>
				customEmojisStream(OrganizationId.make(organizationId), (emojis) =>
					M.UpdatedCustomEmojis({ emojis }),
				),
			),
			Subscription.make("membership", [props.channelId, props.userId], ([channelId, userId]) =>
				membershipStream(ChannelId.make(channelId), UserId.make(userId), (memberId) =>
					M.UpdatedMembership({ memberId }),
				),
			),
			Subscription.make("lastOwn", [props.channelId, props.userId], ([channelId, userId]) =>
				lastOwnStream(ChannelId.make(channelId), UserId.make(userId), (last) =>
					M.UpdatedLastOwn({ last }),
				),
			),
			Subscription.make("typing", [props.channelId, props.userId], ([channelId, userId]) =>
				typingStream(ChannelId.make(channelId), UserId.make(userId), (typing) =>
					M.UpdatedTyping({ typing }),
				),
			),
			// `useTypingIndicators`' one-second clock, only while someone else has typed.
			anyoneTyping &&
				Subscription.make("clock", [], () =>
					Stream.fromEffectSchedule(
						Effect.map(Clock.currentTimeMillis, (nowMs) => M.Ticked({ nowMs })),
						Schedule.spaced(Duration.seconds(1)),
					),
				),
			// The indicator is deleted when it is replaced, when typing stops, and when the composer goes.
			indicator !== null &&
				Subscription.make("typingCleanup", [indicator.id, indicator.channelId], () =>
					Stream.unwrap(
						Effect.map(Effect.service(HazelRpc), (rpc) =>
							Stream.fromEffect(
								Effect.never.pipe(Effect.ensuring(deleteIndicator(rpc, indicator))),
							),
						),
					),
				),
			upload !== undefined &&
				Subscription.make(
					"upload",
					[upload.localId, props.channelId, props.organizationId],
					([localId]) =>
						Stream.unwrap(
							Effect.map(Effect.service(ComposerFiles), (files) =>
								files
									.upload({
										localId,
										organizationId: props.organizationId,
										channelId: props.channelId,
									})
									.pipe(Stream.map((event) => M.ReceivedUploadEvent({ localId, event }))),
							),
						),
				),
			props.ready &&
				model.held.length > 0 &&
				Subscription.make("held", [model.held.length], () => Stream.succeed(M.ReleasedHeld())),
		]
	},
	view: (h, model) => {
		const options = optionsOf(model.trigger, dataOf(model))
		const command = model.command
		const send = canSend(model.draft.text, model.uploads)
		const typing = Typing.typingNamesOf(model.others, model.nowMs)
		const context: Content.ComposerContext | undefined =
			model.mode._tag === "Replying"
				? { kind: "reply", author: model.mode.author, text: model.mode.text }
				: model.mode._tag === "Editing"
					? { kind: "edit", text: "" }
					: undefined
		const mentions = [
			...model.members.map((member) => ({ id: member.userId, name: member.name })),
			...model.bots.map((bot) => ({ id: bot.userId, name: bot.name })),
			...model.groups.map((group) => ({ id: group.id, name: group.handle })),
		]
		const uploading = currentUpload(model.uploads) !== undefined
		return h.stack.density("compact").children(
			// HAZEL-GAP(p4-composer-typing-float): today the line floats over the list's bottom edge.
			typing.length === 0 ? null : h.typingIndicator.names(typing),
			h.composer
				.ref(FieldRef)
				.placeholder(h.props.placeholder)
				.value(model.draft)
				.canSend(model.mode._tag === "Editing" ? !uploading : send || model.command !== null)
				.suggestions(command === null ? options.map((option) => option.suggestion) : [])
				.activeSuggestion(activeOf(options, model.active))
				.emptyText(emptyTextOf(model.trigger))
				.context(context)
				.mentions(mentions)
				.above(
					// HAZEL-GAP(p4-composer-drop-overlay): today a dashed "Drop files here" covers the composer.
					model.dragging && !uploading
						? h.dropZone
								.label("Drop files here")
								.icon("paperclip")
								.multiple()
								.on("files", () => M.DroppedFiles())
						: null,
					model.uploads.length === 0
						? null
						: h.attachmentGrid
								.attachments(attachmentsOf(model.uploads))
								.layout("grid")
								.removable()
								.on("remove", ({ id }) => M.PressedRemoveAttachment({ id }))
								.on("retry", ({ id }) => M.PressedRetryAttachment({ id })),
					command === null ? null : commandPanel(h, command, model.fields),
				)
				.actions(
					h.button
						.icon("paperclip")
						.label("Attach")
						.variant("quiet")
						.disabled(uploading)
						.on("press", M.PressedAttach()),
					h.button.icon("gif").label("GIF").variant("quiet").on("press", M.PressedGif()),
					h.button.icon("emoji").label("Emoji").variant("quiet").on("press", M.PressedEmoji()),
				)
				.on("change", (payload) => M.ChangedDraft({ payload }))
				.on("submit", (payload) => M.SubmittedDraft({ payload }))
				.on("trigger", ({ kind, query }) => M.ChangedTrigger({ kind, query }))
				.on("key", ({ key }) => M.PressedSuggestionKey({ key }))
				.on("pressSuggestion", ({ id }) => M.PressedSuggestion({ id }))
				.on("hoverSuggestion", ({ id }) => M.HoveredSuggestion({ id }))
				.on("editLast", M.PressedEditLast())
				.on("cancelContext", M.CancelledContext())
				.on("escape", M.PressedEscape())
				.on("leave", M.LeftComposer())
				.on("files", () => M.DroppedFiles()),
			EmojiPicker(h, {
				props: { open: model.picker === "emoji", custom: model.customEmojis },
				onEmit: {
					Picked: ({ emoji }) => M.PickedEmojiPickerEmoji({ emoji }),
					RequestedClose: () => M.RequestedCloseEmojiPicker(),
				},
			}),
			GifPicker(h, {
				props: { open: model.picker === "gif" },
				onEmit: {
					Picked: ({ url }) => M.PickedGifPickerGif({ url }),
					RequestedClose: () => M.RequestedCloseGifPicker(),
				},
			}),
		)
	},
})

/** The bot command's argument fields with Execute and Cancel (today's command input panel). */
const commandPanel = (h: Hazel.H<ChannelComposerMessage>, input: CommandInput, fields: Model["fields"]) =>
	// HAZEL-GAP(p4-composer-command-panel): today the panel replaces the text field while it is open.
	h.stack.density("compact").children(
		h.text.strong().children(`/${input.command.name}`),
		...input.command.arguments.map((arg) =>
			h.textField
				.key(arg.name)
				.label(arg.name)
				.description(arg.description ?? undefined)
				.placeholder(arg.placeholder ?? undefined)
				.required(arg.required)
				.value(fields[arg.name] ?? TextField.empty)
				.on("change", (payload) => M.ChangedCommandField({ name: arg.name, payload }))
				.on("submit", () => M.PressedExecuteCommand()),
		),
		h.stack
			.axis("horizontal")
			.children(
				h.button
					.label("Execute")
					.variant("primary")
					.size("xsmall")
					.loading(input.executing)
					.on("press", M.PressedExecuteCommand()),
				h.button
					.label("Cancel")
					.variant("ghost")
					.size("xsmall")
					.on("press", M.PressedCancelCommand()),
			),
	)

/** What the composer runs; the host gives `ComposerHost`, `ComposerFiles`, `BotCommands` and the data. */
export const channelComposerLayer = Layer.mergeAll(
	FocusField.layer,
	BlurField.layer,
	PickFiles.layer,
	TakeDroppedFiles.layer,
	ReleaseFiles.layer,
	SaveDraft.layer,
	NotifyHost.layer,
	SendMessage.layer,
	EditMessage.layer,
	ExecuteBotCommand.layer,
	SendTypingHeartbeat.layer,
	DeleteTypingIndicator.layer,
	WaitForHeartbeatInterval.layer,
	WaitForTypingTimeout.layer,
)

export const ChannelComposer = ChannelComposerNoDeps.pipe(Component.provide(channelComposerLayer))
