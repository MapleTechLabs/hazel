import type { Html, HtmlBuilder } from "foldkit/html"
import { IconDownload } from "../icons"
import { videoIcons } from "./video-icons"

/**
 * Port of `VideoPlayerSimple` (`components/chat/video-player.tsx`): the static, not-yet-played
 * markup Video.js renders (paused, controls visible, duration unknown). No playback logic yet.
 */

const iconCls =
	"block [grid-area:1/1] size-4.5 drop-shadow-[0_1px_0_oklch(0_0_0/0.25)] transition-discrete transition-[display,opacity] duration-150 ease-out"

const iconState = {
	play: {
		button: "group",
		restart: "hidden opacity-0 group-data-ended:block group-data-ended:opacity-100",
		play: "hidden opacity-0 group-not-data-ended:group-data-paused:block group-not-data-ended:group-data-paused:opacity-100",
		pause: "hidden opacity-0 group-not-data-paused:group-not-data-ended:block group-not-data-paused:group-not-data-ended:opacity-100",
	},
	mute: {
		button: "group",
		volumeOff: "hidden opacity-0 group-data-muted:block group-data-muted:opacity-100",
		volumeLow:
			"hidden opacity-0 group-not-data-muted:group-data-[volume-level=low]:block group-not-data-muted:group-data-[volume-level=low]:opacity-100",
		volumeHigh:
			"hidden opacity-0 group-not-data-muted:group-not-data-[volume-level=low]:block group-not-data-muted:group-not-data-[volume-level=low]:opacity-100",
	},
	fullscreen: {
		button: "group",
		enter: "hidden opacity-0 group-not-data-fullscreen:block group-not-data-fullscreen:opacity-100",
		exit: "hidden opacity-0 group-data-fullscreen:block group-data-fullscreen:opacity-100",
	},
}

const btnCls =
	"grid w-[2.375rem] aspect-square bg-transparent rounded-lg items-center justify-center shrink-0 border-none cursor-pointer select-none text-center outline-2 outline-transparent -outline-offset-2 font-medium transition-[background-color,color,outline-offset,scale] duration-150 ease-out focus-visible:outline-current focus-visible:outline-offset-2 text-inherit hover:text-current/80 active:scale-90"

const sliderCls = {
	root: "group/slider relative flex flex-1 items-center justify-center rounded-full outline-none data-[orientation=horizontal]:min-w-20 data-[orientation=horizontal]:w-full data-[orientation=horizontal]:h-5 data-[orientation=vertical]:w-5 data-[orientation=vertical]:h-[4.5rem]",
	track: "relative isolate overflow-hidden bg-current/20 rounded-[inherit] select-none shadow-[0_0_0_1px_oklch(0_0_0/0.05)] data-[orientation=horizontal]:w-full data-[orientation=horizontal]:h-0.75 data-[orientation=vertical]:w-0.75 data-[orientation=vertical]:h-full",
	fill: "absolute rounded-[inherit] pointer-events-none bg-current data-[orientation=horizontal]:inset-y-0 data-[orientation=horizontal]:left-0 data-[orientation=horizontal]:w-(--media-slider-fill,0) data-[orientation=vertical]:inset-x-0 data-[orientation=vertical]:bottom-0 data-[orientation=vertical]:h-(--media-slider-fill,0)",
	buffer: "absolute rounded-[inherit] pointer-events-none bg-current/20 duration-250 ease-out data-[orientation=horizontal]:inset-y-0 data-[orientation=horizontal]:left-0 data-[orientation=horizontal]:transition-[width] data-[orientation=horizontal]:w-(--media-slider-buffer,0) data-[orientation=vertical]:inset-x-0 data-[orientation=vertical]:bottom-0 data-[orientation=vertical]:transition-[height] data-[orientation=vertical]:h-(--media-slider-buffer)",
	thumb: "z-10 absolute size-3 -translate-x-1/2 -translate-y-1/2 bg-current rounded-full shadow-[0_0_0_1px_oklch(0_0_0/0.1),0_1px_3px_0_oklch(0_0_0/0.15),0_1px_2px_-1px_oklch(0_0_0/0.15)] transition-[opacity,scale,outline-offset] duration-150 ease-out select-none outline-2 outline-transparent -outline-offset-2 focus-visible:outline-current focus-visible:outline-offset-2 data-[orientation=horizontal]:top-1/2 data-[orientation=horizontal]:left-(--media-slider-fill,0) data-[orientation=vertical]:left-1/2 data-[orientation=vertical]:top-[calc(100%-var(--media-slider-fill,0))] opacity-0 scale-70 origin-center group-hover/slider:opacity-100 group-hover/slider:scale-100 group-focus-within/slider:opacity-100 group-focus-within/slider:scale-100",
}

const timeCls = {
	group: "flex items-center gap-1",
	current: "hidden tabular-nums @md/media-controls:inline",
	separator: "hidden @md/media-controls:inline @md/media-controls:text-white/50",
	duration: "tabular-nums @md/media-controls:text-current/60",
	controls: "flex flex-row-reverse items-center flex-1 gap-3 @md/media-controls:flex-row",
}

const controlsCls =
	"peer/controls @container/media-controls flex items-center [--media-controls-current-shadow-color:oklch(from_currentColor_0_0_0/clamp(0,calc((l-0.5)*0.5),0.25))] text-shadow-[0_0_1px_var(--media-controls-current-shadow-color)] absolute bottom-0 inset-x-0 pt-8 px-1.5 pb-1.5 gap-2 text-white z-10 will-change-[translate,filter,opacity] transition-[translate,filter,opacity] ease-out delay-0 duration-75 not-data-visible:opacity-0 not-data-visible:translate-y-full not-data-visible:blur-sm not-data-visible:pointer-events-none not-data-visible:delay-500 not-data-visible:duration-500 motion-reduce:not-data-visible:duration-100 motion-reduce:not-data-visible:translate-y-0 motion-reduce:not-data-visible:blur-none @sm/media-root:pt-10 @sm/media-root:px-3 @sm/media-root:pb-3 @sm/media-root:gap-3.5"

const rootCls =
	"block relative isolate @container/media-root rounded-(--media-border-radius,0.75rem) font-[Inter_Variable,Inter,ui-sans-serif,system-ui,sans-serif] text-[0.8125rem] leading-normal subpixel-antialiased **:box-border **:m-0 [&_button]:font-[inherit] motion-safe:[interpolate-size:allow-keywords] bg-black after:absolute after:pointer-events-none after:rounded-[inherit] after:z-10 after:inset-0 after:ring-1 after:ring-inset after:ring-black/15 dark:after:ring-white/15 [&_video]:block [&_video]:w-full [&_video]:h-full [&_video]:rounded-[inherit] [&:fullscreen]:rounded-none"

const overlayCls =
	"absolute inset-0 flex flex-col items-start pointer-events-none rounded-[inherit] opacity-0 bg-linear-to-t from-black/70 via-black/50 via-[7.5rem] to-transparent backdrop-blur-none backdrop-saturate-120 backdrop-brightness-90 transition-[opacity,backdrop-filter] ease-out duration-500 delay-500 peer-data-visible/controls:opacity-100 peer-data-visible/controls:duration-150 peer-data-visible/controls:delay-0 motion-reduce:duration-100"

const bufferingCls =
	"absolute inset-0 hidden items-center justify-center pointer-events-none text-white data-visible:flex"

const buttonGroupCls = "flex items-center gap-[0.075rem] @2xl/media-root:gap-0.5"

export interface VideoPlayerProps<M> {
	/** Stable per-player id; stands in for React's `useId` in anchor names and `aria-controls`. */
	readonly id: string
	readonly src: string
	readonly fileName: string
	readonly onDownload?: M
}

/** Attributes Video.js puts on its tooltip/popover trigger buttons. */
const triggerAttributes = <M>(h: HtmlBuilder<M>, anchor: string) => [
	h.Attribute("data-align", "center"),
	h.Attribute("data-side", "top"),
	h.Attribute("style", `anchor-name: --${anchor};`),
	h.Type("button"),
]

export const videoPlayerView = <M>(h: HtmlBuilder<M>, props: VideoPlayerProps<M>): Html => {
	const icons = videoIcons(h)
	const anchor = (part: string) => `${props.id}-${part}`
	const mediaButtonAttributes = (label: string, part: string, group: string) => [
		h.AriaLabel(label),
		h.Class(`${btnCls} ${group}`),
		...triggerAttributes(h, anchor(part)),
		h.Role("button"),
		h.Tabindex(0),
	]
	const time = (type: "current" | "duration", label: string, className: string) =>
		h.time(
			[
				h.AriaLabel(label),
				h.Attribute("aria-valuetext", "0 seconds"),
				h.Class(className),
				h.Attribute("data-type", type),
				h.Attribute("datetime", "PT0S"),
			],
			["0:00"],
		)
	const horizontal = h.Attribute("data-orientation", "horizontal")
	return h.div(
		[h.Class("group relative inline-block max-w-md")],
		[
			h.div(
				[h.Class(rootCls)],
				[
					h.video(
						[
							h.Class("block max-h-80 w-full"),
							h.Attribute("playsinline", ""),
							h.Attribute("src", props.src),
						],
						[],
					),
					h.div([h.Class(bufferingCls)], [icons.spinner(iconCls)]),
					h.div(
						[
							h.Class(controlsCls),
							h.Attribute("data-controls", ""),
							h.Attribute("data-user-active", ""),
							h.Attribute("data-visible", ""),
						],
						[
							h.span(
								[h.Class(buttonGroupCls)],
								[
									h.button(
										[
											...mediaButtonAttributes("Play", "play", iconState.play.button),
											h.Attribute("data-paused", ""),
										],
										[
											icons.restart(`${iconCls} ${iconState.play.restart}`),
											icons.play(`${iconCls} ${iconState.play.play}`),
											icons.pause(`${iconCls} ${iconState.play.pause}`),
										],
									),
								],
							),
							h.span(
								[h.Class(timeCls.controls)],
								[
									h.span(
										[h.Class(timeCls.group)],
										[
											time("current", "Current time", timeCls.current),
											h.span([h.AriaHidden(true), h.Class(timeCls.separator)], ["/"]),
											time("duration", "Duration", timeCls.duration),
										],
									),
									h.div(
										[
											h.Class(sliderCls.root),
											horizontal,
											h.Attribute(
												"style",
												"--media-slider-fill: 0.000%; --media-slider-pointer: 0.000%; --media-slider-buffer: 0.000%; touch-action: none; user-select: none;",
											),
										],
										[
											h.div(
												[h.Class(sliderCls.track), horizontal],
												[
													h.div([h.Class(sliderCls.fill), horizontal], []),
													h.div([h.Class(sliderCls.buffer), horizontal], []),
												],
											),
											h.div(
												[
													h.AriaLabel("Seek"),
													h.Attribute("aria-orientation", "horizontal"),
													h.Attribute("aria-valuemax", "0"),
													h.Attribute("aria-valuemin", "0"),
													h.Attribute("aria-valuenow", "0"),
													h.Attribute("aria-valuetext", "0 seconds of 0 seconds"),
													h.Attribute("autocomplete", "off"),
													h.Class(sliderCls.thumb),
													horizontal,
													h.Role("slider"),
													h.Tabindex(0),
												],
												[],
											),
										],
									),
								],
							),
							h.span(
								[h.Class(buttonGroupCls)],
								[
									h.button(
										[
											...mediaButtonAttributes("Mute", "mute", iconState.mute.button),
											h.Attribute("aria-controls", `popup-${anchor("volume")}`),
											h.Attribute("aria-expanded", "false"),
											h.Attribute("aria-haspopup", "dialog"),
											h.Attribute("data-volume-level", "high"),
										],
										[
											icons.volumeOff(`${iconCls} ${iconState.mute.volumeOff}`),
											icons.volumeLow(`${iconCls} ${iconState.mute.volumeLow}`),
											icons.volumeHigh(`${iconCls} ${iconState.mute.volumeHigh}`),
										],
									),
									h.button(
										[
											...mediaButtonAttributes(
												"Enter fullscreen",
												"fullscreen",
												iconState.fullscreen.button,
											),
											h.Attribute("data-availability", "available"),
										],
										[
											icons.fullscreenEnter(`${iconCls} ${iconState.fullscreen.enter}`),
											icons.fullscreenExit(`${iconCls} ${iconState.fullscreen.exit}`),
										],
									),
									h.button(
										[
											h.AriaLabel("Download video"),
											h.Class(btnCls),
											...triggerAttributes(h, anchor("download")),
											...(props.onDownload === undefined
												? []
												: [h.OnClick(props.onDownload, { propagation: "Stop" })]),
										],
										[IconDownload(h, { className: iconCls })],
									),
								],
							),
						],
					),
					h.div([h.Class(overlayCls)], []),
				],
			),
			h.div([h.Class("mt-1.5 truncate font-medium text-muted-fg text-xs")], [props.fileName]),
		],
	)
}
