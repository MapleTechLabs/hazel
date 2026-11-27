// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/custom-emojis` (the deleted `web-foldkit/src/page/settings/custom-emojis`): the
 * workspace's custom emojis. Owners and admins upload one (drop or pick an image, name it, save) and
 * delete them; a name a deleted emoji held offers to restore it with the new image.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { CustomEmojiId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq, isNull } from "@tanstack/db"
import { Cause, Effect, Layer, Option, Schema } from "effect"
import { withData } from "../../../app/live"
import { ShowToast } from "../../../app/requests"
import { Session } from "../../../app/session"
import * as Confirm from "../../../components/ConfirmAction"
import { formatDistanceToNow } from "../../../lib/format-distance"
import {
	CommonReason,
	copyOf,
	errorToast,
	type ErrorCopy,
	reasonOf,
	successToast,
} from "../../../modals/feedback"
import { modalServices } from "../../../modals/services"
import { cardHeader, settingsCard, settingsColumn } from "../settings-card"
import { EMOJI_ACCEPT, EmojiFiles, HeldFile, UploadProblem, uploadCopy } from "./emoji-files"

export const Emoji = Schema.Struct({
	id: CustomEmojiId,
	name: Schema.String,
	imageUrl: Schema.String,
	createdAtMs: Schema.NullOr(Schema.Finite),
	creatorName: Schema.String,
})
export type Emoji = typeof Emoji.Type

/** The held image's preview and the name being typed. */
export const Draft = Schema.Struct({ previewUrl: Schema.String, name: TextField.State })
export type Draft = typeof Draft.Type

export const DeleteTarget = Schema.Struct({ id: CustomEmojiId, name: Schema.String })
export type DeleteTarget = typeof DeleteTarget.Type

export const RestoreTarget = Schema.Struct({
	id: CustomEmojiId,
	name: Schema.String,
	imageUrl: Schema.String,
	newImageUrl: Schema.String,
})
export type RestoreTarget = typeof RestoreTarget.Type

export const CreateFailure = Schema.Union([UploadProblem, Schema.Literal("NameTaken"), CommonReason])
export type CreateFailure = typeof CreateFailure.Type
export const RestoreFailure = Schema.Union([Schema.Literals(["NotFound", "NameTaken"]), CommonReason])
export type RestoreFailure = typeof RestoreFailure.Type
export const DeleteFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DeleteFailure = typeof DeleteFailure.Type

export const CustomEmojisMessage = UiSchema.TaggedEnum({
	UpdatedEmojis: { emojis: Schema.Array(Emoji) },
	PressedBrowse: {},
	DroppedFiles: {},
	HeldFile: { file: Schema.NullOr(HeldFile) },
	RejectedFile: { reason: CreateFailure },
	ChangedName: { payload: TextField.ChangePayload },
	PressedCancelUpload: {},
	ReleasedFile: {},
	PressedSave: {},
	SucceededCreateEmoji: { name: Schema.String, previewUrl: Schema.String },
	FoundDeletedEmoji: { target: RestoreTarget },
	FailedCreateEmoji: { reason: CreateFailure },
	PressedConfirmRestore: {},
	CancelledRestore: {},
	SucceededRestoreEmoji: { name: Schema.String, previewUrl: Schema.NullOr(Schema.String) },
	FailedRestoreEmoji: { reason: RestoreFailure },
	PressedDeleteEmoji: { id: CustomEmojiId, name: Schema.String },
	PressedConfirmDelete: {},
	CancelledDelete: {},
	SucceededDeleteEmoji: { name: Schema.String },
	FailedDeleteEmoji: { reason: DeleteFailure },
})
export type CustomEmojisMessage = typeof CustomEmojisMessage.Type

export const CustomEmojisProps = Schema.Struct({ session: Session, nowMs: Schema.Finite })
export type CustomEmojisProps = typeof CustomEmojisProps.Type

export const CustomEmojisModel = Schema.Struct({
	/** `null` while the live query loads (the table's skeleton rows). */
	emojis: Schema.NullOr(Schema.Array(Emoji)),
	draft: Schema.NullOr(Draft),
	/** The draft's upload and create are running. */
	isCreating: Schema.Boolean,
	deleteConfirm: Confirm.ConfirmState(DeleteTarget),
	/** Asked when the draft's name belongs to a deleted emoji. */
	restoreConfirm: Confirm.ConfirmState(RestoreTarget),
})
export type CustomEmojisModel = typeof CustomEmojisModel.Type

// NAMES

export const NAME_MAX = 64

/** A file's name as a shortcode: lowercase, `_` for anything else, at most 64. */
export const generateEmojiName = (filename: string): string =>
	filename
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, NAME_MAX)

/** Today's shortcode rules and copy; null when the name is good. */
export const nameError = (name: string): string | null =>
	name === ""
		? "Name is required"
		: name.length > NAME_MAX
			? "Name must be 64 characters or less"
			: /^[a-z0-9_-]+$/.test(name)
				? null
				: "Only lowercase letters, numbers, hyphens, and underscores"

// COMMANDS

const isUploadProblem = Schema.is(UploadProblem)

const fileMessage = (effect: Effect.Effect<HeldFile | null, { readonly reason: CreateFailure }>) =>
	effect.pipe(
		Effect.match({
			onSuccess: (file) => CustomEmojisMessage.HeldFile({ file }),
			onFailure: (error) => CustomEmojisMessage.RejectedFile({ reason: error.reason }),
		}),
	)

export class PickEmojiFile extends Command.Service<PickEmojiFile>()("hazel/settings/emojis/Pick", {
	args: {},
	success: CustomEmojisMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(Effect.service(EmojiFiles), (files) => () => fileMessage(files.pick)),
	)
}

export class TakeDroppedEmoji extends Command.Service<TakeDroppedEmoji>()(
	"hazel/settings/emojis/TakeDropped",
	{
		args: {},
		success: CustomEmojisMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(Effect.service(EmojiFiles), (files) => () => fileMessage(files.dropped)),
	)
}

export class ReleaseEmojiFile extends Command.Service<ReleaseEmojiFile>()("hazel/settings/emojis/Release", {
	args: { previewUrl: Schema.String },
	success: CustomEmojisMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(EmojiFiles),
			(files) =>
				({ previewUrl }) =>
					files.release(previewUrl).pipe(Effect.as(CustomEmojisMessage.ReleasedFile())),
		),
	)
}

const errorOf = (cause: Cause.Cause<unknown>) =>
	Option.getOrUndefined(Cause.findErrorOption(cause)) as
		| { readonly _tag?: string; readonly reason?: unknown; readonly [key: string]: unknown }
		| undefined

/** Uploads the held image and creates the emoji; `previewUrl` names the draft the result belongs to. */
export class CreateEmoji extends Command.Service<CreateEmoji>()("hazel/settings/emojis/Create", {
	args: {
		organizationId: OrganizationId,
		name: Schema.String,
		previewUrl: Schema.String,
		createdBy: UserId,
	},
	success: CustomEmojisMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const files = yield* EmojiFiles
			const { data, run } = yield* modalServices
			return ({ organizationId, name, previewUrl, createdBy }) =>
				files.upload(previewUrl, organizationId).pipe(
					Effect.matchEffect({
						onFailure: (error) =>
							Effect.succeed(CustomEmojisMessage.FailedCreateEmoji({ reason: error.reason })),
						onSuccess: (imageUrl) =>
							run(
								data.actions.createCustomEmojiAction({
									organizationId,
									name,
									imageUrl,
									createdBy,
								}),
							).pipe(
								Effect.as(CustomEmojisMessage.SucceededCreateEmoji({ name, previewUrl })),
								Effect.catchCause((cause): Effect.Effect<CustomEmojisMessage> => {
									const error = errorOf(cause)
									// A deleted emoji holds the name: offer to restore it with the new image.
									if (error?._tag === "CustomEmojiDeletedExistsError")
										return Effect.succeed(
											CustomEmojisMessage.FoundDeletedEmoji({
												target: {
													id: error["customEmojiId"] as CustomEmojiId,
													name: String(error["emojiName"]),
													imageUrl: String(error["imageUrl"]),
													newImageUrl: imageUrl,
												},
											}),
										)
									if (error?._tag === "CustomEmojiNameConflictError")
										return Effect.succeed(
											CustomEmojisMessage.FailedCreateEmoji({ reason: "NameTaken" }),
										)
									// BOUNDARY: every other failure reads as its common reason.
									return Effect.succeed(
										CustomEmojisMessage.FailedCreateEmoji({ reason: reasonOf(error) }),
									)
								}),
							),
					}),
				)
		}),
	)
}

export class RestoreEmoji extends Command.Service<RestoreEmoji>()("hazel/settings/emojis/Restore", {
	args: {
		emojiId: CustomEmojiId,
		organizationId: OrganizationId,
		name: Schema.String,
		imageUrl: Schema.String,
		createdBy: UserId,
		/** The draft that hit the deleted name, cleared on success unless the user picked another. */
		previewUrl: Schema.NullOr(Schema.String),
	},
	success: CustomEmojisMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ previewUrl, ...args }) =>
					run(data.actions.restoreCustomEmojiAction(args)).pipe(
						Effect.as(CustomEmojisMessage.SucceededRestoreEmoji({ name: args.name, previewUrl })),
						Effect.catchCause((cause) => {
							const error = errorOf(cause)
							const reason: RestoreFailure =
								error?._tag === "CustomEmojiNotFoundError"
									? "NotFound"
									: error?._tag === "CustomEmojiNameConflictError"
										? "NameTaken"
										: reasonOf(error)
							return Effect.succeed(CustomEmojisMessage.FailedRestoreEmoji({ reason }))
						}),
					),
		),
	)
}

export class DeleteEmoji extends Command.Service<DeleteEmoji>()("hazel/settings/emojis/Delete", {
	args: { emojiId: CustomEmojiId, name: Schema.String },
	success: CustomEmojisMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ emojiId, name }) =>
					run(data.actions.deleteCustomEmojiAction({ emojiId })).pipe(
						Effect.as(CustomEmojisMessage.SucceededDeleteEmoji({ name })),
						Effect.catchCause((cause) => {
							const error = errorOf(cause)
							const reason: DeleteFailure =
								error?._tag === "CustomEmojiNotFoundError" ? "NotFound" : reasonOf(error)
							return Effect.succeed(CustomEmojisMessage.FailedDeleteEmoji({ reason }))
						}),
					),
		),
	)
}

// DATA

interface EmojiRow {
	readonly id: CustomEmojiId
	readonly name: string
	readonly imageUrl: string
	readonly createdAt?: Date | null
	readonly creatorFirstName: string
	readonly creatorLastName: string
}

const emojisStream = (organizationId: OrganizationId) =>
	withData((data) =>
		data.liveQueryStream<EmojiRow, CustomEmojisMessage>(
			(q) =>
				q
					.from({ emoji: data.collections.customEmojiCollection })
					.where(({ emoji }) => eq(emoji.organizationId, organizationId))
					.where(({ emoji }) => isNull(emoji.deletedAt))
					.innerJoin({ creator: data.collections.userCollection }, ({ emoji, creator }) =>
						eq(emoji.createdBy, creator.id),
					)
					.orderBy(({ emoji }) => emoji.createdAt, "desc")
					.select(({ emoji, creator }) => ({
						...emoji,
						creatorFirstName: creator.firstName,
						creatorLastName: creator.lastName,
					})),
			(rows) =>
				CustomEmojisMessage.UpdatedEmojis({
					emojis: rows.map((row) => ({
						id: row.id,
						name: row.name,
						imageUrl: row.imageUrl,
						createdAtMs: row.createdAt ? new Date(row.createdAt).getTime() : null,
						creatorName: `${row.creatorFirstName} ${row.creatorLastName}`,
					})),
				}),
		),
	)

// COPY

const createCopy = (reason: CreateFailure): ErrorCopy =>
	isUploadProblem(reason)
		? uploadCopy(reason)
		: copyOf(reason, {
				NameTaken: {
					title: "Failed to create emoji",
					description: "The name is already taken. Please try another.",
				},
			})

const restoreCopy = (reason: RestoreFailure): ErrorCopy =>
	copyOf(reason, {
		NotFound: { title: "Failed to restore emoji", description: "The deleted emoji no longer exists." },
		NameTaken: {
			title: "Failed to restore emoji",
			description: "Another emoji already uses this name. Please try another.",
		},
	})

const deleteCopy = (reason: DeleteFailure): ErrorCopy =>
	copyOf(reason, {
		NotFound: { title: "Failed to delete emoji", description: "It may have already been deleted." },
	})

const errorStep = (copy: ErrorCopy) => ShowToast.make({ toast: errorToast(copy) })

/** A create or a confirmed restore is running; the draft is locked meanwhile. */
export const isBusy = (model: CustomEmojisModel) =>
	model.isCreating || model.restoreConfirm._tag === "Running"

const isAdminOf = (session: Session) => session.member?.role === "owner" || session.member?.role === "admin"

// VIEW

const EmojisDef = Hazel.component({
	name: "CustomEmojisPage",
	props: CustomEmojisProps,
	model: CustomEmojisModel,
	message: CustomEmojisMessage,
	// After Back, the held file and any write in flight are gone.
	restore: (model) => ({
		...model,
		draft: null,
		isCreating: false,
		deleteConfirm: model.deleteConfirm._tag === "Running" ? Confirm.closed : model.deleteConfirm,
		restoreConfirm: Confirm.closed,
	}),
})

type H = Parameters<Parameters<typeof EmojisDef.make>[0]["view"]>[0]

const draftForm = (h: H, model: CustomEmojisModel, draft: Draft) => {
	const busy = isBusy(model)
	const error = nameError(draft.name.text)
	return h.frame.key("draft").children(
		h.stack
			.axis("horizontal")
			.align("start")
			.density("regular")
			.wrap()
			.children(
				// HAZEL-GAP(p4-image-tile): today's preview sits in a 96px `bg-secondary` rounded tile, `object-contain`.
				h.image.key("preview").src(draft.previewUrl).alt("Emoji preview").width(96).height(96),
				h.stack
					.key("fields")
					.density("cozy")
					.children(
						// HAZEL-GAP(p4-field-counter): today's field shows `n/64` at the end of its description line.
						h.textField
							.key("name")
							.label("Name")
							.placeholder("emoji_name")
							.prefix(":")
							.suffix(":")
							.value(draft.name)
							.disabled(busy)
							.error(draft.name.text === "" ? undefined : (error ?? undefined))
							.description(
								error === null || draft.name.text === ""
									? "Lowercase letters, numbers, hyphens, and underscores"
									: undefined,
							)
							.on("change", (payload) => CustomEmojisMessage.ChangedName({ payload })),
						h.stack
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								h.spacer,
								h.button
									.key("cancel")
									.label("Cancel")
									.variant("secondary")
									.size("small")
									.disabled(busy)
									.on("press", CustomEmojisMessage.PressedCancelUpload()),
								h.button
									.key("save")
									.label(busy ? "Saving..." : "Save emoji")
									.size("small")
									.disabled(busy || error !== null)
									.on("press", CustomEmojisMessage.PressedSave()),
							),
					),
			),
	)
}

// HAZEL-GAP(p4-table-column-widths): today's columns are w-20, w-48, w-36 and w-24; the closest are narrow, wide, regular, narrow.
const COLUMNS = [
	{ key: "emoji", label: "Emoji", width: "narrow" },
	{ key: "shortcode", label: "Shortcode", width: "fill" },
	{ key: "creator", label: "Added by", width: "wide", optional: true },
	{ key: "added", label: "Added", width: "regular", optional: true },
	{ key: "actions", label: "Actions", align: "end", width: "narrow" },
] as const

const emojiRow = (h: H, emoji: Emoji, isAdmin: boolean, nowMs: number) =>
	h.tableRow.key(emoji.id).children(
		h.tableCell
			.column("emoji")
			.children(h.image.src(emoji.imageUrl).alt(emoji.name).width(32).height(32)),
		h.tableCell.column("shortcode").children(h.text.strong().children(`:${emoji.name}:`)),
		h.tableCell.column("creator").children(h.text.tone("muted").children(emoji.creatorName)),
		h.tableCell
			.column("added")
			.children(
				h.text
					.tone("muted")
					.children(
						emoji.createdAtMs === null ? "—" : formatDistanceToNow(emoji.createdAtMs, nowMs),
					),
			),
		h.tableCell.column("actions").children(
			isAdmin
				? h.button
						.label(`Delete :${emoji.name}:`)
						.icon("trash")
						.iconOnly()
						.variant("danger")
						.size("small")
						.on(
							"press",
							CustomEmojisMessage.PressedDeleteEmoji({ id: emoji.id, name: emoji.name }),
						)
				: null,
		),
	)

const emojiList = (h: H, model: CustomEmojisModel, isAdmin: boolean, nowMs: number) =>
	model.emojis !== null && model.emojis.length === 0
		? h.emptyState
				.key("empty")
				.icon("emoji")
				.title("No custom emojis yet")
				.description("Upload custom emojis to use in messages across your workspace.")
				.action(
					isAdmin
						? h.button
								.label("Upload emoji")
								.size("small")
								.on("press", CustomEmojisMessage.PressedBrowse())
						: undefined,
				)
		: h.table
				.key("emojis")
				.label("Custom emojis")
				.columns(COLUMNS)
				.loading(model.emojis === null)
				.loadingRows(5)
				.children(...(model.emojis ?? []).map((emoji) => emojiRow(h, emoji, isAdmin, nowMs)))

const restoreDialog = (h: H, model: CustomEmojisModel) => {
	const state = model.restoreConfirm
	const target = Confirm.targetOf(state)
	const isRunning = state._tag === "Running"
	const tile = (src: string, label: string) =>
		h.stack
			.key(label)
			.align("center")
			.density("snug")
			.children(
				h.image.src(src).alt(label).width(64).height(64),
				h.text.role("caption").tone("muted").children(label),
			)
	// HAZEL-GAP(p4-dialog-description-strong): today's description sets `:name:` in bold, under a refresh icon tile.
	return h.dialog
		.key("restore-emoji")
		.open(state._tag !== "Closed")
		.title("Restore deleted emoji")
		.description(
			`An emoji named :${target?.name ?? ""}: was previously deleted. Would you like to restore it with your new image?`,
		)
		.on("dismiss", CustomEmojisMessage.CancelledRestore())
		.actions(
			h.button
				.key("cancel")
				.label("Cancel")
				.variant("outline")
				.on("press", CustomEmojisMessage.CancelledRestore()),
			h.button
				.key("confirm")
				.label(isRunning ? "Restoring..." : "Restore with new image")
				.loading(isRunning)
				.disabled(isRunning)
				.on("press", CustomEmojisMessage.PressedConfirmRestore()),
		)
		.children(
			target !== undefined && target.imageUrl !== target.newImageUrl
				? h.stack
						.key("images")
						.axis("horizontal")
						.align("center")
						.density("relaxed")
						.children(
							h.spacer,
							tile(target.imageUrl, "Previous"),
							h.text.tone("muted").children("→"),
							tile(target.newImageUrl, "New"),
							h.spacer,
						)
				: null,
		)
}

/** Drops the draft and releases its file. */
const clearDraft = (model: CustomEmojisModel) => ({
	model: { ...model, draft: null },
	release: model.draft === null ? null : ReleaseEmojiFile.make({ previewUrl: model.draft.previewUrl }),
})

export const CustomEmojisPageNoDeps = EmojisDef.make({
	init: () => ({
		emojis: null,
		draft: null,
		isCreating: false,
		deleteConfirm: Confirm.closed,
		restoreConfirm: Confirm.closed,
	}),
	update: {
		UpdatedEmojis: ($, { emojis }) => $.evolve({ emojis: () => emojis }),
		// A file picked while a save runs would replace the draft being saved.
		PressedBrowse: ($) => (isBusy($.model) ? $.model : $.run(PickEmojiFile.make({}))),
		DroppedFiles: ($) => (isBusy($.model) ? $.model : $.run(TakeDroppedEmoji.make({}))),
		HeldFile: ($, { file }) => {
			if (file === null) return $.model
			if (isBusy($.model)) return $.run(ReleaseEmojiFile.make({ previewUrl: file.previewUrl }))
			const { release } = clearDraft($.model)
			const next = $.evolve({
				draft: () => ({
					previewUrl: file.previewUrl,
					name: TextField.set(TextField.empty, generateEmojiName(file.fileName)),
				}),
			})
			return release === null ? next : next.run(release)
		},
		RejectedFile: ($, { reason }) => $.run(errorStep(createCopy(reason))),
		ChangedName: ($, { payload }) =>
			$.evolve({
				draft: (draft) => {
					if (draft === null) return null
					const typed = TextField.changed(draft.name, payload)
					const lower = typed.text.toLowerCase()
					return { ...draft, name: lower === typed.text ? typed : TextField.set(typed, lower) }
				},
			}),
		PressedCancelUpload: ($) => {
			const { model, release } = clearDraft($.model)
			return release === null ? $.set(model) : $.set(model).run(release)
		},
		ReleasedFile: ($) => $.model,
		PressedSave: ($) => {
			const draft = $.model.draft
			const { organization, user } = $.props.session
			if (draft === null || nameError(draft.name.text) !== null) return $.model
			if (organization === null || user === null || isBusy($.model)) return $.model
			return $.evolve({ isCreating: () => true }).run(
				CreateEmoji.make({
					organizationId: organization.id,
					name: draft.name.text,
					previewUrl: draft.previewUrl,
					createdBy: user.id,
				}),
			)
		},
		SucceededCreateEmoji: ($, { name, previewUrl }) => {
			const toast = ShowToast.make({ toast: successToast(`Emoji :${name}: created`) })
			const settled = { ...$.model, isCreating: false }
			if (settled.draft?.previewUrl !== previewUrl) return $.set(settled).run(toast)
			const { model, release } = clearDraft(settled)
			return release === null ? $.set(model).run(toast) : $.set(model).run(toast).run(release)
		},
		FoundDeletedEmoji: ($, { target }) =>
			$.evolve({ isCreating: () => false, restoreConfirm: (state) => Confirm.ask(state, target) }),
		FailedCreateEmoji: ($, { reason }) =>
			$.evolve({ isCreating: () => false }).run(errorStep(createCopy(reason))),
		CancelledRestore: ($) => $.evolve({ restoreConfirm: Confirm.cancel }),
		PressedConfirmRestore: ($) => {
			const { organization, user } = $.props.session
			const confirmed = Confirm.confirm($.model.restoreConfirm)
			if (organization === null || user === null || $.model.isCreating || confirmed === undefined)
				return $.model
			const [restoreConfirm, target] = confirmed
			return $.evolve({ restoreConfirm: () => restoreConfirm }).run(
				RestoreEmoji.make({
					emojiId: target.id,
					organizationId: organization.id,
					name: target.name,
					imageUrl: target.newImageUrl,
					createdBy: user.id,
					previewUrl: $.model.draft?.previewUrl ?? null,
				}),
			)
		},
		SucceededRestoreEmoji: ($, { name, previewUrl }) => {
			const toast = ShowToast.make({ toast: successToast(`Emoji :${name}: restored`) })
			const settled = { ...$.model, restoreConfirm: Confirm.closed }
			if (settled.draft === null || settled.draft.previewUrl !== previewUrl)
				return $.set(settled).run(toast)
			const { model, release } = clearDraft(settled)
			return release === null ? $.set(model).run(toast) : $.set(model).run(toast).run(release)
		},
		FailedRestoreEmoji: ($, { reason }) =>
			$.evolve({ restoreConfirm: Confirm.failed }).run(errorStep(restoreCopy(reason))),
		PressedDeleteEmoji: ($, { id, name }) =>
			$.evolve({ deleteConfirm: (state) => Confirm.ask(state, { id, name }) }),
		CancelledDelete: ($) => $.evolve({ deleteConfirm: Confirm.cancel }),
		PressedConfirmDelete: ($) => {
			const confirmed = Confirm.confirm($.model.deleteConfirm)
			if (confirmed === undefined) return $.model
			const [deleteConfirm, target] = confirmed
			return $.evolve({ deleteConfirm: () => deleteConfirm }).run(
				DeleteEmoji.make({ emojiId: target.id, name: target.name }),
			)
		},
		SucceededDeleteEmoji: ($, { name }) =>
			$.evolve({ deleteConfirm: () => Confirm.closed }).run(
				ShowToast.make({ toast: successToast(`Emoji :${name}: deleted`) }),
			),
		FailedDeleteEmoji: ($, { reason }) =>
			$.evolve({ deleteConfirm: Confirm.failed }).run(errorStep(deleteCopy(reason))),
	},
	subscriptions: ({ props }) => {
		const organization = props.session.organization
		return organization === null
			? []
			: [
					Subscription.make("emojis", [organization.id], ([id]) =>
						emojisStream(OrganizationId.make(id)),
					),
				]
	},
	view: (h, model) => {
		const { session, nowMs } = h.props
		if (session.organization === null) return h.stack.key("custom-emojis-page")
		const isAdmin = isAdminOf(session)
		const isPermissionsLoading = session.member === null
		const count = model.emojis?.length ?? 0
		return settingsColumn(
			h,
			"custom-emojis-page",
			settingsCard(
				h,
				"emojis-card",
				cardHeader(h, {
					icon: "emoji",
					title: "Custom emojis",
					subtitle: "Upload and manage custom emojis for your workspace.",
					badge: `${count} emoji${count === 1 ? "" : "s"}`,
				}),
				h.divider.key("header-rule"),
				isAdmin || isPermissionsLoading
					? // HAZEL-GAP(p4-settings-card-band): today's band is `px-4 py-4 md:px-6` over a hairline.
						h.stack
							.key("upload")
							.inset("page")
							.children(
								model.draft === null
									? h.dropZone
											.key("drop")
											.label("Drop an image or click to browse")
											.description("PNG, GIF, or WebP · Max 256KB")
											.icon("emoji-add")
											.accept(EMOJI_ACCEPT)
											.disabled(isPermissionsLoading || !isAdmin)
											.on("press", CustomEmojisMessage.PressedBrowse())
											.on("files", () => CustomEmojisMessage.DroppedFiles())
									: draftForm(h, model, model.draft),
							)
					: null,
				isAdmin || isPermissionsLoading ? h.divider.key("upload-rule") : null,
				emojiList(h, model, isAdmin, nowMs),
			),
			Confirm.confirmDialog(h, model.deleteConfirm, {
				key: "delete-emoji",
				title: "Delete custom emoji",
				description: `Are you sure you want to delete :${Confirm.targetOf(model.deleteConfirm)?.name ?? ""}:? Messages that use this emoji will show the text code instead.`,
				confirmLabel: "Delete emoji",
				runningLabel: "Deleting...",
				confirmed: CustomEmojisMessage.PressedConfirmDelete(),
				cancelled: CustomEmojisMessage.CancelledDelete(),
			}),
			restoreDialog(h, model),
		)
	},
})

/** The page with its Commands; the host provides `EmojiFiles`, `ClientData`, `HazelRpc` and `AppRequests`. */
export const CustomEmojisPage = CustomEmojisPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			PickEmojiFile.layer,
			TakeDroppedEmoji.layer,
			ReleaseEmojiFile.layer,
			CreateEmoji.layer,
			RestoreEmoji.layer,
			DeleteEmoji.layer,
		),
	),
)
