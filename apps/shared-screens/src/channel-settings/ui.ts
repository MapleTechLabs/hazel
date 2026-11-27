// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the channel settings tabs share: today's `pageHeader` at the `title` size, the tab's name over
 * its subtitle, with actions at its end.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { CommonReason } from "../modals/feedback"

/** Today's `isRetryableReason`: a failure in transit is worth a "Try again". */
export const isRetryable = (reason: CommonReason): boolean =>
	reason === "Offline" || reason === "Timeout" || reason === "Unavailable"

export const pageHeader = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		title: string
		subtitle: string
		actions?: ReadonlyArray<Hazel.NoTextInput<Msg>>
	}>,
) => {
	const titles = h.stack
		.density("tight")
		.children(
			h.heading.level("2").size("large").children(options.title),
			h.text.role("label").tone("muted").children(options.subtitle),
		)
	// HAZEL-GAP(p4-page-header-actions): today's titles grow (`flex-1 basis-72`), so on a phone the
	// actions wrap under them at the start; here they wrap at the end.
	return options.actions === undefined
		? titles
		: h.stack
				.axis("horizontal")
				.density("regular")
				.align("start")
				.wrap()
				.children(titles, h.spacer, ...options.actions)
}
