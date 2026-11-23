import type { Html, HtmlBuilder } from "foldkit/html"
import { sectionLabelRoot } from "../../ui/section-label"

/** The two-column row every my-settings page repeats: a `SectionLabel` on the left, the controls on the right. */
export const settingsRow = <Message>(
	h: HtmlBuilder<Message>,
	label: { readonly title: string; readonly description?: string },
	content: Html,
): Html =>
	h.div(
		[h.Class("grid grid-cols-1 gap-5 lg:grid-cols-[minmax(200px,280px)_1fr] lg:gap-8")],
		[sectionLabelRoot(h, { size: "sm", title: label.title, description: label.description }), content],
	)
