import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { dialogTitleBase } from "~/components/ui/dialog.styles"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { IconClose } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { button } from "../../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../../ui/dialog"
import * as Field from "../../../ui/field"
import { loader } from "../../../ui/loader"
import * as Modal from "../../../ui/modal"
import { switchControl } from "../../../ui/switch"
import { textField } from "../../../ui/text-field"
import { Message, type Model, type Workspace } from "./share-modal"

const toModalMessage = (message: Modal.Message) => Message.GotModalMessage({ message })
const toChangedQuery = (value: string) => Message.ChangedWorkspaceQuery({ value })
const toToggledGuests = (isSelected: boolean) => Message.ToggledAllowGuestMemberAdds({ isSelected })

const resultRow = (h: HtmlBuilder<Message>, workspace: Workspace): Html => {
	const isShareable = !!workspace.slug
	return h.keyed("button")(
		workspace.id,
		[
			h.Type("button"),
			...(isShareable ? [h.OnClick(Message.ClickedWorkspace({ workspace }))] : [h.Disabled(true)]),
			h.Class(
				"flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
			),
		],
		[
			avatar(h, { size: "sm", isSquare: true, src: workspace.logoUrl, seed: workspace.name }),
			h.div(
				[h.Class("flex flex-1 flex-col")],
				[
					h.span([h.Class("font-medium text-fg text-sm")], [workspace.name]),
					workspace.slug
						? h.span([h.Class("text-muted-fg text-xs")], [workspace.slug])
						: h.span([h.Class("text-danger text-xs")], ["Shareable slug required"]),
				],
			),
		],
	)
}

const searchMessage = (h: HtmlBuilder<Message>, text: string): Html =>
	h.div([h.Class("px-4 py-6 text-center text-muted-fg text-sm")], [text])

const searchLoading = (h: HtmlBuilder<Message>): Html =>
	h.div([h.Class("flex items-center justify-center py-6")], [loader(h)])

const workspaceList = (h: HtmlBuilder<Message>, workspaces: ReadonlyArray<Workspace>): Html =>
	workspaces.length === 0
		? searchMessage(h, "No public workspaces found")
		: h.div(
				[h.Class("divide-y divide-border")],
				workspaces.map((workspace) => resultRow(h, workspace)),
			)

const searchFailed = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class("flex flex-col items-center gap-2 px-4 py-6 text-center"), h.Role("alert")],
		[
			h.span([h.Class("font-medium text-fg text-sm")], [message.title]),
			...(message.description === undefined
				? []
				: [h.span([h.Class("text-muted-fg text-xs")], [message.description])]),
			...(isRetryableReason(reason)
				? [
						button(h, { intent: "outline", size: "sm", onPress: Message.ClickedRetrySearch() }, [
							"Try again",
						]),
					]
				: []),
		],
	)
}

const searchResults = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("rounded-lg border border-border bg-bg")],
		[
			AsyncData.match(model.searchResults, {
				onIdle: () => searchLoading(h),
				onLoading: () => searchLoading(h),
				onRefreshing: (workspaces) => workspaceList(h, workspaces),
				onFailure: (reason) => searchFailed(h, reason),
				onStale: ({ error }) => searchFailed(h, error),
				onSuccess: (workspaces) => workspaceList(h, workspaces),
			}),
		],
	)

const selectedChip = (h: HtmlBuilder<Message>, workspace: Workspace): Html =>
	h.div(
		[h.Class("flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-2.5 py-1.5")],
		[
			avatar(h, { size: "xxs", isSquare: true, src: workspace.logoUrl, seed: workspace.name }),
			h.span([h.Class("font-medium text-fg text-sm")], [workspace.name]),
			h.button(
				[
					h.Type("button"),
					h.OnClick(Message.ClickedClearWorkspace()),
					h.AriaLabel("Clear workspace"),
					h.Class("ml-auto text-muted-fg hover:text-fg"),
				],
				[IconClose(h, { className: "size-4" })],
			),
		],
	)

const body = (h: HtmlBuilder<Message>, model: Model, channelName: string): Html => {
	const selected = model.selectedWorkspace
	return h.submodel({
		slotId: "share-channel-modal",
		model: model.modal,
		view: Modal.view,
		viewInputs: {
			size: "lg",
			toContent: () => [
				dialogHeader(h, {}, [
					// `<ModalTitle>Share #{channelName}</ModalTitle>`: two text nodes.
					h.h2(
						[
							h.Class(twMerge(dialogTitleBase)),
							h.Id(Modal.titleId(model.modal.id)),
							h.Attribute("slot", "title"),
						],
						["Share #", channelName],
					),
					Field.description(h, {}, ["Invite another workspace to collaborate in this channel."]),
				]),
				dialogBody(
					h,
					[
						h.div(
							[h.Class("flex flex-col gap-2")],
							[
								textField(
									h,
									{
										id: "share-workspace",
										value: selected ? selected.name : model.searchQuery,
										onInput: toChangedQuery,
									},
									(field) => [
										field.label(["Workspace"]),
										field.input({
											placeholder: "Search public workspaces by name or slug...",
										}),
									],
								),
								...(selected === null && model.searchQuery.length >= 2
									? [searchResults(h, model)]
									: []),
								...(selected === null ? [] : [selectedChip(h, selected)]),
							],
						),
						h.div(
							[h.Class("rounded-lg border border-border px-4 py-3")],
							[
								switchControl(
									h,
									{
										id: "share-allow-guests",
										isSelected: model.allowGuestMemberAdds,
										onChange: toToggledGuests,
									},
									[
										h.div(
											[h.Class("flex flex-col gap-0.5")],
											[
												Field.label(
													h,
													{
														elementType: "span",
														className: "font-medium text-fg text-sm",
													},
													["Allow guests to add members"],
												),
												h.span(
													[h.Class("text-muted-fg text-xs")],
													[
														"Guests can invite their own team members to this shared channel.",
													],
												),
											],
										),
									],
								),
							],
						),
					],
					"flex flex-col gap-5",
				),
				dialogFooter(h, [
					button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
					button(
						h,
						{
							intent: "primary",
							isDisabled: !selected?.slug || model.isSubmitting,
							onPress: Message.ClickedSendInvite(),
						},
						[model.isSubmitting ? "Sending..." : "Send invite"],
					),
				]),
			],
		},
		toParentMessage: toModalMessage,
	})
}

const view = Submodel.defineView<Model, Message, Readonly<{ channelName: string }>>((model, inputs, h) =>
	body(h, model, inputs.channelName),
)

/** The modal, opened from the page (`isOpen` / `onOpenChange`); it has no trigger of its own. */
export const shareChannelModal = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	channelName: string,
	toParentMessage: (message: Message) => ParentMessage,
): Html => h.submodel({ slotId: "share-channel", model, view, viewInputs: { channelName }, toParentMessage })
