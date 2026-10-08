import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconRocket, IconUser, IconUsers } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const BoxKey = Schema.Literals(["team", "plan", "channels"])
type BoxKey = typeof BoxKey.Type

const Model = Schema.Struct({
	team: ChoiceBox.Model,
	plan: ChoiceBox.Model,
	channels: ChoiceBox.Model,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotChoiceBoxMessage: { box: BoxKey, message: ChoiceBox.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

const toBoxMessage =
	(box: BoxKey) =>
	(message: ChoiceBox.Message): Message =>
		Message.GotChoiceBoxMessage({ box, message })

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotChoiceBoxMessage: ({ box, message }) =>
			Update.foldChild({
				update: ChoiceBox.update,
				read: (current: Model) => Option.some(current[box]),
				write: (current: Model, next: ChoiceBox.Model): Model => ({ ...current, [box]: next }),
				toParentMessage: toBoxMessage(box),
			})(model, message),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const common = (box: BoxKey) => ({
		model: model[box],
		toParentMessage: toBoxMessage(box),
		interaction: interaction.wiring(model),
	})
	return galleryFrame(h, "Choice box", [
		gallerySection(h, "Grid", [
			h.div(
				[h.Class("w-[36rem]")],
				ChoiceBox.choiceBox(h, { ...common("team"), ariaLabel: "Team size", columns: 2, gap: 4 }, [
					{
						key: "solo",
						textValue: "Just me",
						content: (parts) => [
							IconUser(h),
							parts.label(["Just me"]),
							parts.description(["Personal workspace"]),
						],
					},
					{
						key: "small",
						textValue: "2-10",
						content: (parts) => [
							IconUsers(h),
							parts.label(["2-10"]),
							parts.description(["Small team"]),
						],
					},
					{
						key: "large",
						textValue: "11+",
						content: (parts) => [
							IconRocket(h),
							parts.label(["11+"]),
							parts.description(["Growing company"]),
						],
					},
				]),
			),
		]),
		gallerySection(h, "Stack", [
			h.div(
				[h.Class("w-96")],
				ChoiceBox.choiceBox(h, { ...common("plan"), ariaLabel: "Plan" }, [
					{ key: "free", label: "Free", description: "For trying things out" },
					{ key: "pro", label: "Pro", description: "For growing teams" },
					{
						key: "enterprise",
						label: "Enterprise",
						description: "Talk to sales",
						isDisabled: true,
					},
				]),
			),
		]),
		gallerySection(h, "Multiple", [
			h.div(
				[h.Class("w-96")],
				ChoiceBox.choiceBox(h, { ...common("channels"), ariaLabel: "Channels" }, [
					{ key: "general", label: "General", description: "Company-wide updates" },
					{ key: "random", label: "Random", description: "Everything else" },
				]),
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Choice box", {
	Model,
	init: () => ({
		model: {
			team: ChoiceBox.init({ id: "team", selectedKeys: ["small"] }),
			plan: ChoiceBox.init({ id: "plan", selectedKeys: ["pro"] }),
			channels: ChoiceBox.init({
				id: "channels",
				selectionMode: "multiple",
				selectedKeys: ["general"],
			}),
			interaction: Interaction.init(),
		},
	}),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
