import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag } from "../icons"
import { progressBar, progressBarTrack } from "../ui/progress-bar"
import { tabStrip, tabView } from "../ui/tab-strip"
import type { ChannelSummary } from "./model"

/** Route layouts as view helpers: each wraps the page body the way the legacy `layout.tsx` does. */

/** `settings/layout.tsx`, `my-settings/layout.tsx` and `notifications/layout.tsx` (identical). */
export const sectionLayout = <Message>(h: HtmlBuilder<Message>, page: Html): Html =>
	h.main(
		[h.Class("h-full w-full min-w-0 bg-bg")],
		[h.div([h.Class("flex h-full min-h-0 w-full flex-col overflow-y-auto pt-6 pb-12")], [page])],
	)

/** `settings/integrations/layout.tsx` and `settings/chat-sync/layout.tsx` (inside `sectionLayout`). */
export const contentColumnLayout = <Message>(h: HtmlBuilder<Message>, page: Html): Html =>
	h.div([h.Class("flex flex-col gap-6 px-4 lg:px-8")], [page])

export const ChannelSettingsTab = ["overview", "integrations", "connect"] as const
export type ChannelSettingsTab = (typeof ChannelSettingsTab)[number]

const isChannelSettingsTab = (value: string): value is ChannelSettingsTab =>
	ChannelSettingsTab.some((tab) => tab === value)

const tabLabels: Readonly<Record<ChannelSettingsTab, string>> = {
	overview: "Overview",
	integrations: "Integrations",
	connect: "Connect",
}

/** `ChannelIcon` */
const channelIcon = <Message>(h: HtmlBuilder<Message>, icon: string | null | undefined, className: string) =>
	icon
		? h.span([h.Attribute("data-slot", "icon"), h.Class(className)], [icon])
		: IconHashtag(h, { className })

/** `channels/$channelId/settings/layout.tsx`: back link, channel header and the tab bar. */
export const channelSettingsLayout = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		orgSlug: string
		channelId: string
		channel: ChannelSummary | null
		selectedTab: ChannelSettingsTab
		/** Tabs navigate on selection, as `onSelectionChange` does. */
		onSelectTab: (href: string) => Attribute<Message>
		/** The mobile `<select>` navigates on change, with the chosen option's href. */
		onChangeTab: (toHref: (tab: string) => string) => Attribute<Message>
	}>,
	page: Html,
): Html => {
	const hrefOf = (tab: ChannelSettingsTab) =>
		`/${options.orgSlug}/channels/${options.channelId}/settings/${tab}`
	return h.main(
		[h.Class("h-full w-full min-w-0 bg-bg")],
		[
			h.div(
				[h.Class("flex h-full min-h-0 w-full flex-col gap-8 overflow-y-auto pt-8 pb-12")],
				[
					h.div(
						[h.Class("flex flex-col gap-5 px-4 lg:px-8")],
						[
							h.div(
								[h.Class("flex flex-col gap-4")],
								[
									h.a(
										[
											h.Class(
												"flex items-center gap-2 text-muted-fg text-sm transition-colors hover:text-fg",
											),
											h.Href(`/${options.orgSlug}/chat/${options.channelId}`),
										],
										[
											h.svg(
												[
													h.Class("size-4"),
													h.Attribute("fill", "none"),
													h.Attribute("stroke", "currentColor"),
													h.Attribute("stroke-width", "2"),
													h.Attribute("viewBox", "0 0 24 24"),
												],
												[
													h.path([
														h.Attribute(
															"d",
															"M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
														),
														h.Attribute("stroke-linecap", "round"),
														h.Attribute("stroke-linejoin", "round"),
													]),
												],
											),
											"Back to channel",
										],
									),
									h.div(
										[h.Class("flex items-center gap-3")],
										[
											h.div(
												[
													h.Class(
														"flex size-10 items-center justify-center rounded-lg bg-secondary text-xl",
													),
												],
												[
													channelIcon(
														h,
														options.channel?.icon,
														"size-5 text-muted-fg",
													),
												],
											),
											h.div(
												[h.Class("flex flex-col")],
												[
													h.h1(
														[h.Class("font-semibold text-fg text-xl")],
														[options.channel?.name ?? "Channel"],
													),
													h.span(
														[h.Class("text-muted-fg text-sm")],
														["Channel settings"],
													),
												],
											),
										],
									),
								],
							),
							h.div(
								[h.Class("md:hidden")],
								[
									h.select(
										[
											h.Class(
												"w-full appearance-none rounded-lg border border-input bg-bg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] text-base/6 text-fg outline-hidden focus:border-ring/70 focus:ring-3 focus:ring-ring/20 sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6",
											),
											h.Value(options.selectedTab),
											options.onChangeTab((tab) =>
												hrefOf(isChannelSettingsTab(tab) ? tab : options.selectedTab),
											),
										],
										ChannelSettingsTab.map((tab) =>
											h.option(
												[
													h.Value(tab),
													...(tab === options.selectedTab
														? [h.Selected(true)]
														: []),
												],
												[tabLabels[tab]],
											),
										),
									),
								],
							),
							h.div(
								[
									h.Class(
										"scrollbar-hide -mx-4 -my-1 flex w-full max-w-full overflow-x-auto px-4 py-1 lg:-mx-8 lg:px-8",
									),
								],
								[
									tabStrip(
										h,
										{ className: "max-md:hidden" },
										ChannelSettingsTab.map((tab) =>
											tabView(h, {
												id: tab,
												label: tabLabels[tab],
												isSelected: tab === options.selectedTab,
												attributes: [options.onSelectTab(hrefOf(tab))],
											}),
										),
									),
								],
							),
						],
					),
					page,
				],
			),
		],
	)
}

/** `sign-in/$.tsx` and `sign-up/$.tsx`: Clerk's prebuilt form, centered. */
export const authLayout = <Message>(h: HtmlBuilder<Message>, page: Html): Html =>
	h.div([h.Class("flex min-h-dvh items-center justify-center p-6")], [page])

/** `components/loader.tsx`: the full-page loader `_app` shows while auth or the user loads. */
export const appLoader = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("flex h-screen flex-col items-center justify-center gap-6")],
		[
			h.div(
				[h.Class("flex w-full max-w-sm flex-col items-center gap-4")],
				[
					h.div(
						[
							h.Class(
								"mask-radial-at-center mask-radial-from-black mask-radial-to-transparent relative aspect-square w-full",
							),
						],
						[
							h.img([
								h.Attribute("src", "/images/squirrle_window.webp"),
								h.Attribute("alt", "squirrel"),
								h.Class(
									"mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover",
								),
							]),
						],
					),
					progressBar(h, { isIndeterminate: true, ariaLabel: "Loading" }, [
						progressBarTrack(h, { isIndeterminate: true }),
					]),
				],
			),
			h.p(
				[h.Class("font-bold font-mono text-xl")],
				[
					"Loading",
					h.span(
						[h.Class("inline-block")],
						[
							"animate-bounce [animation-delay:0s]",
							"animate-bounce [animation-delay:0.2s]",
							"animate-bounce [animation-delay:0.4s]",
						].map((className) => h.span([h.Class(className)], ["."])),
					),
				],
			),
		],
	)
