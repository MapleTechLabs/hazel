// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Share a channel over Hazel Connect (today's `connect/share-modal.ts`): search public workspaces,
 * pick one with a slug, choose whether its guests may add members, send the invite. The Connect page
 * draws it, so a sent invite refreshes the page's list (`Sent`).
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { ChannelId, OrganizationId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Cause, Duration, Effect, Layer, Option, Schema } from "effect"
import { AppRequests } from "../../../app/requests"
import { isRetryable } from "../../ui"
import {
	CommonReason,
	commonCopy,
	copyOf,
	errorToast,
	reasonOf,
	successToast,
	toast,
} from "../../../modals/feedback"

export const Workspace = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type Workspace = typeof Workspace.Type

export const ShareChannelProps = Schema.Struct({
	channelId: ChannelId,
	channelName: Schema.String,
	organizationId: Schema.NullOr(OrganizationId),
})
export type ShareChannelProps = typeof ShareChannelProps.Type

/** The search: idle below two characters or once a workspace is picked. */
export const SearchState = Schema.Union([
	Schema.TaggedStruct("Idle", {}),
	Schema.TaggedStruct("Loading", {}),
	Schema.TaggedStruct("Found", { workspaces: Schema.Array(Workspace) }),
	Schema.TaggedStruct("Failed", { reason: CommonReason }),
])
export type SearchState = typeof SearchState.Type

export const ShareChannelModel = Schema.Struct({
	query: TextField.State,
	/** Bumped on every keystroke and retry; only the latest search counts. */
	version: Schema.Finite,
	search: SearchState,
	selected: Schema.NullOr(Workspace),
	allowGuestMemberAdds: Schema.Boolean,
	submitting: Schema.Boolean,
})
export type ShareChannelModel = typeof ShareChannelModel.Type

export const ShareChannelMessage = UiSchema.TaggedEnum({
	ChangedQuery: { payload: TextField.ChangePayload },
	SucceededSearch: { version: Schema.Finite, workspaces: Schema.Array(Workspace) },
	FailedSearch: { version: Schema.Finite, reason: CommonReason },
	PressedRetrySearch: {},
	PressedWorkspace: { workspace: Workspace },
	PressedClearWorkspace: {},
	ToggledAllowGuests: { checked: Schema.Boolean },
	PressedCancel: {},
	PressedSend: {},
	SucceededSend: {},
	FailedSend: {},
})
export type ShareChannelMessage = typeof ShareChannelMessage.Type

export const ShareChannelEvents = UiSchema.TaggedEnum({ RequestedClose: {}, Sent: {} })

/** Searches after today's 300ms pause (`delayed`), or at once on a retry. */
export class SearchWorkspaces extends Command.Service<SearchWorkspaces>()("hazel/connect/SearchWorkspaces", {
	args: {
		version: Schema.Finite,
		query: Schema.String,
		organizationId: OrganizationId,
		delayed: Schema.Boolean,
	},
	success: ShareChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ version, query, organizationId, delayed }) =>
					Effect.sleep(Duration.millis(delayed ? 300 : 0)).pipe(
						Effect.andThen(rpc("connectShare.workspace.search", { query, organizationId })),
						Effect.map((response) =>
							ShareChannelMessage.SucceededSearch({
								version,
								workspaces: response.data.map((result) => ({
									id: result.id,
									name: result.name,
									slug: result.slug,
									logoUrl: result.logoUrl,
								})),
							}),
						),
						// BOUNDARY: a failed search reads as its common reason.
						Effect.catchCause((cause) =>
							Effect.succeed(
								ShareChannelMessage.FailedSearch({
									version,
									reason: reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
								}),
							),
						),
					),
		),
	)
}

/** Sends the invite; its toast outlives the modal. */
export class CreateInvite extends Command.Service<CreateInvite>()("hazel/connect/CreateInvite", {
	args: {
		channelId: ChannelId,
		guestOrganizationId: OrganizationId,
		slug: Schema.String,
		allowGuestMemberAdds: Schema.Boolean,
	},
	success: ShareChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			const requests = yield* AppRequests
			return ({ channelId, guestOrganizationId, slug, allowGuestMemberAdds }) =>
				rpc("connectShare.invite.create", {
					channelId,
					guestOrganizationId,
					target: { kind: "slug", value: slug },
					allowGuestMemberAdds,
				}).pipe(
					Effect.andThen(toast(successToast("Invite sent"))),
					Effect.as(ShareChannelMessage.SucceededSend()),
					Effect.catchTags({
						ConnectWorkspaceNotFoundError: () =>
							toast(
								errorToast({
									title: "Workspace not found",
									description: "No workspace matches that name or slug.",
								}),
							).pipe(Effect.as(ShareChannelMessage.FailedSend())),
						ConnectChannelAlreadySharedError: () =>
							toast(
								errorToast({
									title: "Already shared",
									description: "This channel is already shared with that organization.",
								}),
							).pipe(Effect.as(ShareChannelMessage.FailedSend())),
						ChannelNotFoundError: () =>
							toast(
								errorToast({
									title: "Channel not found",
									description: "This channel may have been deleted.",
								}),
							).pipe(Effect.as(ShareChannelMessage.FailedSend())),
					}),
					// BOUNDARY: every other failure reads as its common reason.
					Effect.catchCause((cause) =>
						toast(
							errorToast(
								copyOf(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))), {}),
							),
						).pipe(Effect.as(ShareChannelMessage.FailedSend())),
					),
					Effect.provideService(AppRequests, requests),
				)
		}),
	)
}

const ShareChannelDef = Hazel.component({
	name: "ShareChannelModal",
	props: ShareChannelProps,
	model: ShareChannelModel,
	message: ShareChannelMessage,
	events: ShareChannelEvents,
	restore: (model) => ({ ...model, submitting: false }),
})

type H = Parameters<Parameters<typeof ShareChannelDef.make>[0]["view"]>[0]

const note = (h: H, text: string) => h.text.role("label").tone("muted").children(text)

const resultsOf = (h: H, model: ShareChannelModel) => {
	const { search } = model
	if (search._tag === "Idle" || search._tag === "Loading")
		return h.progress.style("spinner").label("Searching workspaces")
	if (search._tag === "Failed") {
		const copy = commonCopy(search.reason)
		const retryable = isRetryable(search.reason)
		return h.stack
			.align("center")
			.density("compact")
			.children(
				h.text.role("label").strong().children(copy.title),
				copy.description === undefined
					? null
					: h.text.role("caption").tone("muted").children(copy.description),
				retryable
					? h.button
							.label("Try again")
							.variant("outline")
							.size("small")
							.on("press", ShareChannelMessage.PressedRetrySearch())
					: null,
			)
	}
	if (search.workspaces.length === 0) return note(h, "No public workspaces found")
	return h.section.style("list").children(
		...search.workspaces.map((workspace) =>
			h.item
				.key(workspace.id)
				.title(workspace.name)
				// HAZEL-GAP(p4-item-subtitle-tone): today's "Shareable slug required" is danger ink.
				.subtitle(workspace.slug ?? "Shareable slug required")
				.disabled(workspace.slug === null)
				.leading(
					h.avatar
						.name(workspace.name)
						.src(workspace.logoUrl ?? undefined)
						.size("small")
						.corners("square"),
				)
				.on("press", ShareChannelMessage.PressedWorkspace({ workspace })),
		),
	)
}

/** A fresh search for the current query, superseding any in flight. */
const searching = (model: ShareChannelModel, organizationId: OrganizationId | null, delayed: boolean) => {
	const version = model.version + 1
	const query = model.query.text
	return {
		model: { ...model, version, search: { _tag: "Loading" as const } },
		command:
			organizationId === null
				? null
				: SearchWorkspaces.make({ version, query, organizationId, delayed }),
	}
}

export const ShareChannelModalNoDeps = ShareChannelDef.make({
	init: () => ({
		query: TextField.empty,
		version: 0,
		search: { _tag: "Idle" as const },
		selected: null,
		allowGuestMemberAdds: false,
		submitting: false,
	}),
	update: {
		ChangedQuery: ($, { payload }) => {
			const query = TextField.changed($.model.query, payload)
			const base = { ...$.model, query, selected: null, version: $.model.version + 1 }
			if (query.text.length < 2) return $.set({ ...base, search: { _tag: "Idle" as const } })
			const next = searching({ ...$.model, query, selected: null }, $.props.organizationId, true)
			return next.command === null ? $.set(next.model) : $.set(next.model).run(next.command)
		},
		SucceededSearch: ($, { version, workspaces }) =>
			version !== $.model.version
				? $.model
				: $.evolve({ search: () => ({ _tag: "Found" as const, workspaces }) }),
		FailedSearch: ($, { version, reason }) =>
			version !== $.model.version
				? $.model
				: $.evolve({ search: () => ({ _tag: "Failed" as const, reason }) }),
		PressedRetrySearch: ($) => {
			if ($.model.search._tag !== "Failed") return $.model
			const next = searching($.model, $.props.organizationId, false)
			return next.command === null ? $.set(next.model) : $.set(next.model).run(next.command)
		},
		PressedWorkspace: ($, { workspace }) =>
			workspace.slug === null
				? $.model
				: $.evolve({
						selected: () => workspace,
						query: (query) => TextField.set(query, workspace.name),
						search: () => ({ _tag: "Idle" as const }),
					}),
		PressedClearWorkspace: ($) =>
			$.evolve({ selected: () => null, query: (query) => TextField.set(query, "") }),
		ToggledAllowGuests: ($, { checked }) => $.evolve({ allowGuestMemberAdds: () => checked }),
		PressedCancel: ($) => $.emit(ShareChannelEvents.RequestedClose()),
		PressedSend: ($) => {
			const { selected, submitting, allowGuestMemberAdds } = $.model
			if (selected === null || selected.slug === null || submitting) return $.model
			return $.evolve({ submitting: () => true }).run(
				CreateInvite.make({
					channelId: $.props.channelId,
					guestOrganizationId: selected.id,
					slug: selected.slug,
					allowGuestMemberAdds,
				}),
			)
		},
		SucceededSend: ($) => $.emit(ShareChannelEvents.Sent()),
		FailedSend: ($) => $.evolve({ submitting: () => false }),
	},
	view: (h, model) => {
		const { selected } = model
		const showResults = selected === null && model.query.text.length >= 2
		return h.dialog
			.open(true)
			.title(`Share #${h.props.channelName}`)
			.description("Invite another workspace to collaborate in this channel.")
			.on("dismiss", ShareChannelMessage.PressedCancel())
			.children(
				h.stack.density("compact").children(
					h.textField
						.label("Workspace")
						.placeholder("Search public workspaces by name or slug...")
						.value(model.query)
						.on("change", (payload) => ShareChannelMessage.ChangedQuery({ payload })),
					showResults ? h.frame.surface("flush").children(resultsOf(h, model)) : null,
					selected === null
						? null
						: h.frame.surface("muted").children(
								h.stack
									.axis("horizontal")
									.density("compact")
									.align("center")
									.children(
										h.avatar
											.name(selected.name)
											.src(selected.logoUrl ?? undefined)
											.size("xxsmall")
											.corners("square"),
										h.text.role("label").strong().children(selected.name),
										h.spacer,
										h.button
											.label("Clear workspace")
											.icon("close")
											.iconOnly()
											.variant("ghost")
											.size("xsmall")
											.on("press", ShareChannelMessage.PressedClearWorkspace()),
									),
							),
				),
				// HAZEL-GAP(p4-toggle-box): today's switch sits in a bordered box.
				h.frame.surface("inset").children(
					h.toggle
						.label("Allow guests to add members")
						.description("Guests can invite their own team members to this shared channel.")
						.checked(model.allowGuestMemberAdds)
						.on("change", ({ checked }) => ShareChannelMessage.ToggledAllowGuests({ checked })),
				),
			)
			.actions(
				h.button.label("Cancel").variant("outline").on("press", ShareChannelMessage.PressedCancel()),
				h.button
					.label(model.submitting ? "Sending..." : "Send invite")
					.disabled(selected === null || selected.slug === null || model.submitting)
					.on("press", ShareChannelMessage.PressedSend()),
			)
	},
})

export const ShareChannelModal = ShareChannelModalNoDeps.pipe(
	Component.provide(Layer.mergeAll(SearchWorkspaces.layer, CreateInvite.layer)),
)
