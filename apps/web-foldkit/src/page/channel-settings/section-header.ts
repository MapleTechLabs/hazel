import type { Html, HtmlBuilder } from "foldkit/html"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"

/** The `SectionHeader.Root className="border-none pb-0"` every channel settings tab opens with. */
export const tabHeader = <Message>(
	h: HtmlBuilder<Message>,
	heading: string,
	subheading: string,
	actions: ReadonlyArray<Html> = [],
): Html =>
	sectionHeaderRoot(h, { className: "border-none pb-0" }, [
		sectionHeaderGroup(h, {}, [
			h.div(
				[h.Class("flex flex-1 flex-col justify-center gap-1")],
				[sectionHeaderHeading(h, {}, [heading]), sectionHeaderSubheading(h, {}, [subheading])],
			),
			...actions,
		]),
	])
