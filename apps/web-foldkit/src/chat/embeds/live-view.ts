import { ACTOR_SERVICE_ERROR_UI_MESSAGE, ACTOR_SERVICE_ERROR_UI_TITLE } from "@hazel/domain"
import type { Html, HtmlBuilder } from "foldkit/html"
import { marked } from "marked"
import remend from "remend"
import { cn } from "~/lib/utils"
import { IconBrainSparkle, IconSparkles, IconWarning } from "../../icons"
import type { LiveActorState } from "../live-state"
import { markdownView } from "../markdown/markdown-view"

/**
 * `MessageLive.*` (`components/chat/message-live-state.tsx`): the loading indicator until the actor
 * produces output, then the progress bar, the streaming text (`StreamingMarkdown`) or the final
 * markdown, and the error card. Agent steps (`AgentSteps`) are not ported.
 */

export interface LiveLoading {
	readonly text: string
	readonly icon: "sparkle" | "brain"
}

const dot = <M>(h: HtmlBuilder<M>, delay: string | null): Html =>
	h.span(
		[
			h.Class("size-1 rounded-full bg-current animate-[ai-thinking-dot_1.4s_ease-in-out_infinite]"),
			...(delay === null ? [] : [h.Attribute("style", `animation-delay: ${delay};`)]),
		],
		[],
	)

/** `MessageLiveLoading`. */
const loadingView = <M>(h: HtmlBuilder<M>, loading: LiveLoading): Html =>
	h.div(
		[h.Class("flex items-center gap-2 text-muted-fg text-sm")],
		[
			(loading.icon === "brain" ? IconBrainSparkle : IconSparkles)(h, {
				className: "size-4",
				attributes: { "aria-hidden": "true" },
			}),
			h.span(
				[h.Class("flex items-center gap-1")],
				[loading.text, h.span([h.Class("inline-flex gap-0.5 ml-0.5")], [dot(h, null), dot(h, "0.2s"), dot(h, "0.4s")])],
			),
		],
	)

/** `ProgressBar`. */
const progressView = <M>(h: HtmlBuilder<M>, value: number): Html => {
	const isComplete = value === 100
	return h.div(
		[h.Class("w-full max-w-xs")],
		[
			h.div(
				[h.Class("h-1.5 w-full overflow-hidden rounded-full bg-muted")],
				[
					h.div(
						[
							h.Class(
								cn(
									"relative h-full rounded-full transition-all duration-500 ease-out",
									isComplete ? "bg-success" : "bg-primary",
								),
							),
							h.Attribute("style", `width: ${value}%;`),
						],
						isComplete
							? []
							: [
									h.div(
										[h.Class("absolute inset-0 overflow-hidden"), h.Attribute("aria-hidden", "true")],
										[
											h.div(
												[
													h.Class(
														"absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[progress-shimmer_1.5s_ease-in-out_infinite]",
													),
												],
												[],
											),
										],
									),
								],
					),
				],
			),
		],
	)
}

const streamingClass = cn(
	"w-full",
	"[&_p]:my-0",
	"[&_blockquote]:relative [&_blockquote]:my-1 [&_blockquote]:pl-4 [&_blockquote]:italic",
	"[&_pre]:my-2 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-sm [&_pre]:overflow-x-auto",
	"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm",
	"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
	"[&_ul]:my-0 [&_ol]:my-0",
	"[&_li]:my-0.5 [&_li]:ml-4",
	"[&_strong]:font-bold",
	"[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1:first-child]:mt-0",
	"[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2:first-child]:mt-0",
	"[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3:first-child]:mt-0",
	"[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
	"[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
	"[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
	undefined,
)

/** `StreamingMarkdown`'s HTML: remend closes what the stream left open, marked renders it. */
const streamingHtml = (text: string) =>
	marked
		.parse(remend(text || ""), { async: false, gfm: true, breaks: false })
		.replace(/<p>\s*<\/p>/g, "")
		.replace(/>\s+</g, "><")
		.trim()

/** `StreamingMarkdown` with `isAnimating`: the text so far and a blinking cursor. */
const streamingView = <M>(h: HtmlBuilder<M>, text: string): Html =>
	h.div(
		[h.Class(streamingClass), h.Attribute("aria-live", "polite"), h.Attribute("aria-busy", "true")],
		[
			h.span([h.InnerHTML(streamingHtml(text))], []),
			h.span(
				[
					h.Class("ml-0.5 text-primary animate-[ai-cursor-blink_1s_ease-in-out_infinite]"),
					h.Attribute("aria-hidden", "true"),
				],
				["|"],
			),
		],
	)

/** `getMessageLiveErrorCopy`. */
const errorCopy = (error: string) =>
	error === ACTOR_SERVICE_ERROR_UI_MESSAGE
		? { title: ACTOR_SERVICE_ERROR_UI_TITLE, body: ACTOR_SERVICE_ERROR_UI_MESSAGE }
		: { title: "Something went wrong", body: error }

/** `ErrorCard`. */
const errorView = <M>(h: HtmlBuilder<M>, error: string): Html => {
	const copy = errorCopy(error)
	return h.div(
		[
			h.Class(
				"rounded-lg border border-danger/20 bg-danger/5 p-4 animate-[error-enter_0.3s_var(--ease-out-cubic)_forwards]",
			),
			h.Attribute("role", "alert"),
		],
		[
			h.div(
				[h.Class("flex items-start gap-3")],
				[
					h.div(
						[h.Class("rounded-full bg-danger/10 p-2 animate-[error-icon-bounce_0.4s_var(--ease-out-cubic)_0.3s]")],
						[IconWarning(h, { className: "size-5 text-danger", attributes: { "aria-hidden": "true" } })],
					),
					h.div(
						[h.Class("flex-1 space-y-1")],
						[
							h.p([h.Class("font-medium text-danger text-sm")], [copy.title]),
							h.p([h.Class("text-muted-fg text-sm")], [copy.body]),
						],
					),
				],
			),
		],
	)
}

/** `MessageLive.Provider` + `Root` with `Progress`, `Steps`, `Text` and `Error`. */
export const liveView = <M>(h: HtmlBuilder<M>, state: LiveActorState, loading: LiveLoading): Html => {
	const isWaitingForContent =
		state.status === "idle" || (state.status === "active" && !state.text && state.stepCount === 0)
	if (isWaitingForContent) return loadingView(h, loading)
	return h.div(
		[h.Class(cn("space-y-2", undefined))],
		[
			state.status === "active" && state.progress !== null ? progressView(h, state.progress) : h.empty,
			state.text ? (state.isStreaming ? streamingView(h, state.text) : markdownView(h, state.text)) : h.empty,
			state.status === "failed" && state.error ? errorView(h, state.error) : h.empty,
		],
	)
}
