import { Duration, Effect, Option, Schema } from "effect"
import { Command, Subscription, Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { ResolvedTheme, resolveSystemTheme } from "../../theme"
import * as Interaction from "../../ui/aria/interaction"
import { button } from "../../ui/button"
import * as Toast from "../../ui/toast"
import * as ToastView from "../../ui/toast-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	toasts: Toast.Model,
	interaction: Interaction.Model,
	theme: ResolvedTheme,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ClickedExample: { label: Schema.String },
	CompletedSaveChanges: { id: Schema.Number },
	GotToastMessage: { message: Toast.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const toToastMessage = (message: Toast.Message) => Message.GotToastMessage({ message })
const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// COMMAND

/** Stands in for `toast.promise(Promise.resolve(), ...)`, which settles after the loading toast paints. */
const SaveGalleryChanges = Command.define("SaveGalleryChanges", {
	args: { id: Schema.Number },
	messages: [Message.CompletedSaveChanges],
	execute: ({ id }) =>
		Effect.sleep(Duration.millis(50)).pipe(Effect.as(Message.CompletedSaveChanges({ id }))),
})

// UPDATE

// Same toasts as `apps/web/src/dev-gallery/entries/toast.tsx`; infinite durations keep captures stable.
const persistent = { duration: Number.POSITIVE_INFINITY }

const examples: ReadonlyArray<Readonly<{ section: string; label: string; options: Toast.ShowOptions }>> = [
	{ section: "Kinds", label: "Default", options: { ...persistent, title: "Message copied" } },
	{
		section: "Kinds",
		label: "Success",
		options: { ...persistent, kind: "success", title: "Channel created" },
	},
	{
		section: "Kinds",
		label: "Error",
		options: { ...persistent, kind: "error", title: "Couldn't send message" },
	},
	{ section: "Kinds", label: "Info", options: { ...persistent, kind: "info", title: "You're offline" } },
	{
		section: "Kinds",
		label: "Warning",
		options: { ...persistent, kind: "warning", title: "Storage almost full" },
	},
	{
		section: "Content",
		label: "With description",
		options: {
			...persistent,
			kind: "success",
			title: "Invitation sent",
			description: "ada@hazel.sh will get an email with a link to join.",
		},
	},
	{
		section: "Content",
		label: "With action",
		options: { ...persistent, title: "Message deleted", actionLabel: "Undo" },
	},
	{
		section: "Async",
		label: "Loading",
		options: { ...persistent, kind: "loading", title: "Uploading attachment…" },
	},
	{
		section: "Async",
		label: "Promise",
		options: { ...persistent, kind: "loading", title: "Saving changes…", isPromise: true },
	},
]

const withToasts = (
	model: Model,
	result: Update.Return<Toast.Model, Toast.Message>,
	extra: ReadonlyArray<Command.Command<Message>> = [],
) => ({
	model: modifyFields(model, { toasts: () => result.model }),
	commands: [...Command.mapMessages(result.commands, toToastMessage), ...extra],
})

const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		ClickedExample: ({ label }) => {
			const example = examples.find((candidate) => candidate.label === label)
			if (example === undefined) return { model }
			const shown = Toast.show(model.toasts, example.options)
			return withToasts(
				model,
				shown,
				example.options.isPromise ? [SaveGalleryChanges({ id: shown.id })] : [],
			)
		},
		CompletedSaveChanges: ({ id }) =>
			withToasts(model, Toast.show(model.toasts, { id, kind: "success", title: "Changes saved" })),
		GotToastMessage: ({ message }) => {
			const result = Toast.update(model.toasts, message)
			return withToasts(model, { model: result.model, commands: result.commands })
		},
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// SUBSCRIPTION

const subscriptions = Subscription.aggregate<Model, Message>()(
	interaction.subscriptions,
	Subscription.lift(Toast.subscriptions)<Model, Message>({
		read: (model) => Option.some(model.toasts),
		toParentMessage: toToastMessage,
	}),
)

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	const section = (title: string) =>
		gallerySection(
			h,
			title,
			examples
				.filter((example) => example.section === title)
				.map((example) =>
					button(
						h,
						{
							intent: "outline",
							onPress: Message.ClickedExample({ label: example.label }),
							interaction: { wiring, target: example.label },
						},
						[example.label],
					),
				),
		)
	return galleryFrame(
		h,
		"Toast",
		[section("Kinds"), section("Content"), section("Async")],
		[
			h.submodel({
				slotId: "toaster",
				model: model.toasts,
				view: ToastView.view,
				viewInputs: { theme: model.theme },
				toParentMessage: toToastMessage,
			}),
		],
	)
}

export const gallery = defineGallery<Model, Message>("Toast", {
	Model,
	init: () => ({
		model: { toasts: Toast.init(), interaction: Interaction.init(), theme: resolveSystemTheme() },
	}),
	update,
	subscriptions,
	view,
})
