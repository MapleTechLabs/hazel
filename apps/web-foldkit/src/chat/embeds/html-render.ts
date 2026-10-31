import type { ChannelId, MessageId } from "@hazel/schema"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { htmlRenderDialogStyles, htmlRenderStyles } from "~/components/embeds/html-render.styles"
import type { HtmlRenderRow } from "../../page/chat/rows"
import { IconMaximize } from "../../icons"
import { button } from "../../ui/button"
import { controlledModal, titleId } from "../../ui/modal"
import * as HtmlRender from "../html-render"
import type { EmbedType } from "./types"

/**
 * An HTML render embed (`MessageEmbed.html`): the bot's page in a sandboxed frame. `allow-scripts`
 * without `allow-same-origin` keeps it in an opaque origin, away from the app's cookies and API.
 */

export type EmbedHtml = NonNullable<EmbedType["html"]>

export interface HtmlRenderContext<M> {
	readonly channelId: ChannelId
	readonly messageId: MessageId
	/** Where the frames show; each surface keeps its own heights. */
	readonly surface: HtmlRender.FrameSurface
	/** The message's frames on that surface, by render id (`MessageRowData.htmlRenders`). */
	readonly rows: ReadonlyArray<HtmlRenderRow>
	readonly toMessage: (message: HtmlRender.Message) => M
}

const styles = htmlRenderStyles()

/** The sandboxed frame's attributes, shared by the inline and fullscreen frames. */
const frameAttributes = <M>(
	h: HtmlBuilder<M>,
	ref: HtmlRender.RenderRef,
	title: string,
	src: string,
	mode: HtmlRender.FrameMode,
	toMessage: (message: HtmlRender.Message) => M,
) => [
	h.Attribute("loading", mode === "fullscreen" ? "eager" : "lazy"),
	h.Attribute("sandbox", "allow-scripts"),
	h.Attribute("referrerpolicy", "no-referrer"),
	h.Attribute("title", title),
	h.Attribute(HtmlRender.RENDER_ID_ATTRIBUTE, ref.renderId),
	h.Attribute(HtmlRender.MESSAGE_ID_ATTRIBUTE, ref.messageId),
	h.Attribute(HtmlRender.MODE_ATTRIBUTE, mode),
	h.Attribute("src", src),
	h.OnLoad(toMessage(HtmlRender.Message.LoadedFrame({ ref, mode }))),
]

const frameView = <M>(
	h: HtmlBuilder<M>,
	ref: HtmlRender.RenderRef,
	title: string,
	row: HtmlRenderRow,
	surface: HtmlRender.FrameSurface,
	toMessage: (message: HtmlRender.Message) => M,
): Html =>
	h.iframe([
		...frameAttributes(h, ref, title, row.src ?? "", surface, toMessage),
		h.Class(htmlRenderStyles({ isLoaded: row.isLoaded }).frame()),
		// The frame's canvas stays transparent only while its color scheme matches the page's.
		h.Style({
			height: `${row.fittedHeight}px`,
			...(row.isLoaded ? { "color-scheme": row.appearance } : {}),
		}),
	])

/** The embed's frame: a skeleton while the URL or page loads, the error copy if it failed. */
export const htmlRenderView = <M>(
	h: HtmlBuilder<M>,
	html: EmbedHtml,
	context: HtmlRenderContext<M>,
): Html => {
	const row = context.rows.find((candidate) => candidate.renderId === html.renderId)
	const { surface, toMessage } = context
	const height = HtmlRender.frameHeightOf(html.height, undefined)
	const shownHeight = row?.shownHeight ?? height.shown
	const status = row?.status ?? "Loading"
	const isLoaded = row?.isLoaded ?? false
	const ref = { channelId: context.channelId, messageId: context.messageId, renderId: html.renderId }
	// Keyed per message: a pooled list container that switches rows inserts a new box, so it mounts.
	return h.keyed("div")(
		`html-render-${HtmlRender.frameKey(surface, ref)}`,
		[
			h.Class(styles.root()),
			h.OnMount(Mount.mapMessage(HtmlRender.FrameMounted({ ref, surface }), toMessage)),
		],
		[
			h.div(
				[h.Class(styles.viewport()), h.Style({ height: `${shownHeight}px` })],
				[
					row !== undefined && row.status === "Ready" && row.src !== null
						? frameView(h, ref, html.title, row, surface, toMessage)
						: h.empty,
					status === "Failed"
						? h.p([h.Class(styles.error())], [`Unable to load ${html.title}`])
						: isLoaded
							? h.empty
							: h.div([h.Class(styles.skeleton()), h.AriaHidden(true)]),
					row?.isTall && !row.isExpanded ? h.div([h.Class(styles.fade())]) : h.empty,
				],
			),
			status === "Ready"
				? button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							className: styles.fullscreen(),
							onPress: toMessage(
								HtmlRender.Message.ClickedFullscreen({ ref, title: html.title }),
							),
							attributes: [h.AriaLabel(`Open ${html.title} full screen`)],
						},
						[IconMaximize(h)],
					)
				: h.empty,
			row?.isTall
				? h.button(
						[
							h.Type("button"),
							h.Class(styles.toggle()),
							h.AriaExpanded(row.isExpanded),
							h.OnClick(toMessage(HtmlRender.Message.ClickedToggleExpanded({ ref, surface }))),
						],
						[row.isExpanded ? "Show less" : "Show more"],
					)
				: h.empty,
		],
	)
}

const dialogStyles = htmlRenderDialogStyles()

/** The fullscreen dialog: the same page in a large frame, on the URL minted for it if needed. */
export const htmlRenderFullscreenView = <M>(
	h: HtmlBuilder<M>,
	model: HtmlRender.Model,
	toMessage: (message: HtmlRender.Message) => M,
): Html => {
	const fullscreen = model.fullscreen
	if (fullscreen === null) return h.empty
	const appearance = model.theme?.appearance ?? "dark"
	return controlledModal(h, {
		model: fullscreen.modal,
		toParentMessage: (message) => toMessage(HtmlRender.Message.GotFullscreenModalMessage({ message })),
		size: "fullscreen",
		className: dialogStyles.panel(),
		toContent: () => [
			h.header(
				[h.Class(dialogStyles.header())],
				[
					h.h2(
						[h.Id(titleId(fullscreen.modal.id)), h.Class(dialogStyles.title())],
						[fullscreen.title],
					),
				],
			),
			h.div(
				[h.Class(dialogStyles.body())],
				[
					fullscreen.src !== null
						? h.keyed("iframe")(HtmlRender.renderKey(fullscreen.ref), [
								...frameAttributes(
									h,
									fullscreen.ref,
									fullscreen.title,
									fullscreen.src,
									"fullscreen",
									toMessage,
								),
								h.Class(dialogStyles.frame()),
								...(fullscreen.isLoaded ? [h.Style({ "color-scheme": appearance })] : []),
							])
						: h.p(
								[h.Class(dialogStyles.status())],
								[fullscreen.isFailed ? `Unable to load ${fullscreen.title}` : "Loading…"],
							),
				],
			),
		],
	})
}
