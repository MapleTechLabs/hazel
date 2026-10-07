import { Option } from "effect"
import { Subscription, Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Interaction from "../../ui/aria/interaction"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import { sectionLabelRoot } from "../../ui/section-label"
import type { PageSubscriptionInput } from "../contract"

/** Markup every my-settings page repeats, ported from the legacy route components. */

/** `<SectionHeader.Root>` with the heading block each page opens with. */
export const pageHeader = <Message>(h: HtmlBuilder<Message>, title: string, subtitle: string): Html =>
	sectionHeaderRoot(h, {}, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex flex-1 flex-col justify-center gap-0.5 self-stretch")],
				[
					sectionHeaderHeading(h, {}, [title]),
					sectionHeaderSubheading(h, {}, [subtitle]),
				],
			),
		]),
	])

/** The two-column row: a `SectionLabel` on the left, the controls on the right. */
export const settingsRow = <Message>(
	h: HtmlBuilder<Message>,
	label: { readonly title: string; readonly description?: string },
	content: Html,
): Html =>
	h.div(
		[h.Class("grid grid-cols-1 gap-5 lg:grid-cols-[minmax(200px,280px)_1fr] lg:gap-8")],
		[sectionLabelRoot(h, { size: "sm", title: label.title, description: label.description }), content],
	)

/** `<hr className="h-px w-full border-none bg-border" />` */
export const divider = <Message>(h: HtmlBuilder<Message>): Html =>
	h.hr([h.Class("h-px w-full border-none bg-border")])

/** The interaction Submodel wiring (hover, press, focus-visible) a page embeds once. */
export const embedInteraction = <Model extends { readonly interaction: Interaction.Model }, Message>(
	toParentMessage: (message: Interaction.Message) => Message,
) => ({
	fold: Update.foldChild({
		update: Interaction.update,
		read: (model: Model) => Option.some(model.interaction),
		write: (model: Model, interaction: Interaction.Model): Model => ({ ...model, interaction }),
		toParentMessage,
	}),
	subscriptions: Subscription.lift(Interaction.subscriptions)<PageSubscriptionInput<Model>, Message>({
		read: (input) => Option.some(input.model.interaction),
		toParentMessage,
	}),
	wiring: (model: Model): Interaction.Wiring<Message> => ({ model: model.interaction, toParentMessage }),
})
