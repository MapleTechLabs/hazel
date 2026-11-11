import type { Html, HtmlBuilder } from "foldkit/html"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import { sectionLabelRoot } from "../../ui/section-label"

/** Markup every my-settings page repeats, ported from the legacy route components. */

/** `<SectionHeader.Root>` with the heading block each page opens with. */
export const pageHeader = <Message>(h: HtmlBuilder<Message>, title: string, subtitle: string): Html =>
	sectionHeaderRoot(h, {}, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex flex-1 flex-col justify-center gap-0.5 self-stretch")],
				[sectionHeaderHeading(h, {}, [title]), sectionHeaderSubheading(h, {}, [subtitle])],
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
