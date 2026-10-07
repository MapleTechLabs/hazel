import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cx } from "~/utils/cx"
import { IconFolders, IconMsgs } from "../../icons"
import { type ChatTab, Message } from "./channel/page"

/** `ChatTabBar`: Messages and Files tabs; selecting one navigates like the legacy `onSelectionChange`. */

/** `Tab` from `components/ui/tabs.tsx`, horizontal orientation. */
const tabView = <M>(
	h: HtmlBuilder<M>,
	options: { id: string; label: string; icon: Html; isSelected: boolean; onClick: M },
) =>
	h.div(
		[
			...(options.isSelected
				? [h.Attribute("aria-selected", "true"), h.Attribute("data-selected", "true")]
				: [h.Attribute("aria-selected", "false")]),
			h.Class(
				twMerge(
					twMerge(
						"group/tab rounded-lg [--tab-gutter:var(--tab-gutter-x)]",
						"[--tab-gutter-x:--spacing(2.5)] [--tab-gutter-y:--spacing(1)] first:-ml-(--tab-gutter) last:-mr-(--tab-gutter)",
						"relative isolate flex cursor-default items-center whitespace-nowrap font-medium text-sm/6 outline-hidden transition",
						"px-(--tab-gutter-x) py-(--tab-gutter-y)",
						"*:data-[slot=icon]:mr-2 *:data-[slot=icon]:-ml-0.5 *:data-[slot=icon]:size-4 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-muted-fg selected:*:data-[slot=icon]:text-primary-subtle-fg",
						"selected:text-primary-subtle-fg text-muted-fg hover:bg-secondary selected:hover:bg-primary-subtle hover:text-fg selected:hover:text-primary-subtle-fg focus:ring-0",
						"disabled:opacity-50",
						"cursor-default",
					),
				),
			),
			h.Attribute("data-key", options.id),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("data-slot", "tab"),
			h.Attribute("role", "tab"),
			h.Attribute("tabindex", options.isSelected ? "0" : "-1"),
			h.OnClick(options.onClick),
		],
		[
			options.icon,
			options.label,
			...(options.isSelected
				? [
						h.div(
							[
								h.Class(
									twMerge(
										"absolute bg-primary-subtle-fg transition-[translate,width,height] duration-200",
										"right-(--tab-gutter-x) -bottom-[calc(var(--tab-gutter-y)+1px)] left-(--tab-gutter-x) h-[2px]",
									),
								),
								h.Attribute("data-rac", ""),
								h.Attribute("data-slot", "selected-indicator"),
							],
							[],
						),
					]
				: []),
		],
	)

export const chatTabBarView = <M>(
	tab: ChatTab,
	toParentMessage: (message: Message) => M,
	h: HtmlBuilder<M>,
): Html =>
	h.div(
		[
			h.Class(cx("flex-col", "group/tabs flex gap-4 forced-color-adjust-none")),
			h.Attribute("data-orientation", "horizontal"),
			h.Attribute("data-rac", ""),
		],
		[
			h.div(
				[
					h.Attribute("aria-orientation", "horizontal"),
					h.Class(
						twMerge([
							"[--tab-list-gutter:--spacing(1)]",
							"relative flex forced-color-adjust-none",
							"flex-row gap-x-(--tab-list-gutter) rounded-(--tab-list-rounded) border-b py-(--tab-list-gutter)",
							"px-4",
						]),
					),
					h.Attribute("data-orientation", "horizontal"),
					h.Attribute("data-rac", ""),
					h.Attribute("data-slot", "tab-list"),
					h.Attribute("role", "tablist"),
				],
				[
					tabView(h, {
						id: "messages",
						label: "Messages",
						icon: IconMsgs(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
						isSelected: tab === "messages",
						onClick: toParentMessage(Message.ClickedTab({ tab: "messages" })),
					}),
					tabView(h, {
						id: "files",
						label: "Files",
						icon: IconFolders(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
						isSelected: tab !== "messages",
						onClick: toParentMessage(Message.ClickedTab({ tab: "files" })),
					}),
				],
			),
		],
	)
