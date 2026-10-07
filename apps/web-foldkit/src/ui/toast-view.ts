import { Array, Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toastClassName, toasterClassName, toasterStyle } from "~/components/ui/toast.styles"
import {
	GAP,
	type Item,
	type Kind,
	MeasureToast,
	Message,
	type Model,
	offsetOf,
	VISIBLE_TOASTS,
} from "./toast"

/** sonner's Toaster markup (`position="bottom-right"`, `richColors`, the shared className and style). */

// sonner's built-in icons (dist/index.mjs), as React renders them.
const iconPaths: Readonly<Record<Exclude<Kind, "loading">, { viewBox: string; d: string }>> = {
	success: {
		viewBox: "0 0 20 20",
		d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z",
	},
	warning: {
		viewBox: "0 0 24 24",
		d: "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z",
	},
	info: {
		viewBox: "0 0 20 20",
		d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z",
	},
	error: {
		viewBox: "0 0 20 20",
		d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z",
	},
}

const icon = (h: HtmlBuilder<Message>, kind: Exclude<Kind, "loading">): Html =>
	h.svg(
		[
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("viewBox", iconPaths[kind].viewBox),
			h.Attribute("fill", "currentColor"),
			h.Attribute("height", "20"),
			h.Attribute("width", "20"),
		],
		[
			h.path([
				h.Attribute("fill-rule", "evenodd"),
				h.Attribute("d", iconPaths[kind].d),
				h.Attribute("clip-rule", "evenodd"),
			]),
		],
	)

const loader = (h: HtmlBuilder<Message>, isVisible: boolean): Html =>
	h.div(
		[h.Class("sonner-loading-wrapper"), h.DataAttribute("visible", String(isVisible))],
		[
			h.div(
				[h.Class("sonner-spinner")],
				Array.makeBy(12, () => h.div([h.Class("sonner-loading-bar")], [])),
			),
		],
	)

/** React writes `className=""` as an empty attribute. */
const emptyClass = (h: HtmlBuilder<Message>) => h.Attribute("class", "")

const iconSlot = (h: HtmlBuilder<Message>, item: Item): ReadonlyArray<Html> => {
	if (item.kind === null && !item.isPromise) return []
	const children = [
		...(item.isPromise || item.kind === "loading" ? [loader(h, item.kind === "loading")] : []),
		...(item.kind !== null && item.kind !== "loading" ? [icon(h, item.kind)] : []),
	]
	return [h.div([emptyClass(h), h.DataAttribute("icon", "")], children)]
}

const styleText = (properties: ReadonlyArray<readonly [string, string | number]>) =>
	properties.map(([name, value]) => `${name}: ${value};`).join(" ")

const toastView = (h: HtmlBuilder<Message>, model: Model, item: Item, index: number): Html => {
	const flag = (name: string, value: boolean) => h.DataAttribute(name, String(value))
	return h.li(
		[
			h.Key(String(item.id)),
			h.Tabindex(0),
			h.Class(toastClassName),
			h.DataAttribute("sonner-toast", ""),
			flag("rich-colors", true),
			flag("styled", true),
			flag("mounted", item.isMounted),
			flag("promise", item.isPromise),
			flag("swiped", false),
			flag("removed", item.isRemoved),
			flag("visible", index + 1 <= VISIBLE_TOASTS),
			h.DataAttribute("y-position", "bottom"),
			h.DataAttribute("x-position", "right"),
			h.DataAttribute("index", String(index)),
			flag("front", index === 0),
			flag("swiping", false),
			flag("dismissible", true),
			...(item.kind === null ? [] : [h.DataAttribute("type", item.kind)]),
			flag("swipe-out", false),
			flag("expanded", model.isExpanded),
			h.Attribute(
				"style",
				styleText([
					["--index", index],
					["--toasts-before", index],
					["--z-index", model.toasts.length - index],
					["--offset", `${offsetOf(model, item)}px`],
					["--initial-height", `${item.initialHeight}px`],
				]),
			),
			h.OnMount(MeasureToast({ id: item.id })),
		],
		[
			...iconSlot(h, item),
			h.div(
				[emptyClass(h), h.DataAttribute("content", "")],
				[
					h.div([emptyClass(h), h.DataAttribute("title", "")], [item.title]),
					...(item.description === null
						? []
						: [h.div([emptyClass(h), h.DataAttribute("description", "")], [item.description])]),
				],
			),
			...(item.actionLabel === null
				? []
				: [
						h.button(
							[
								emptyClass(h),
								h.DataAttribute("button", "true"),
								h.DataAttribute("action", "true"),
								h.OnClick(Message.ClickedAction({ id: item.id })),
							],
							[item.actionLabel],
						),
					]),
		],
	)
}

export type ViewInputs = Readonly<{ theme: "light" | "dark" }>

/** The `<section>` sonner always renders, with the toast list while any toast is queued. */
export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
	h.section(
		[
			h.Attribute("aria-label", "Notifications alt+T"),
			h.Tabindex(-1),
			h.Attribute("aria-live", "polite"),
			h.Attribute("aria-relevant", "additions text"),
			h.Attribute("aria-atomic", "false"),
		],
		model.toasts.length === 0
			? []
			: [
					h.ol(
						[
							h.Attribute("dir", "ltr"),
							h.Tabindex(-1),
							h.Class(toasterClassName),
							h.DataAttribute("sonner-toaster", "true"),
							h.DataAttribute("sonner-theme", viewInputs.theme),
							h.DataAttribute("y-position", "bottom"),
							h.DataAttribute("x-position", "right"),
							h.Attribute(
								"style",
								styleText([
									[
										"--front-toast-height",
										`${Option.getOrElse(
											Option.map(Array.head(model.heights), (height) => height.height),
											() => 0,
										)}px`,
									],
									["--width", "356px"],
									["--gap", `${GAP}px`],
									...Object.entries(toasterStyle),
									...(["top", "right", "bottom", "left"] as const).map(
										(side) => [`--offset-${side}`, "24px"] as const,
									),
									...(["top", "right", "bottom", "left"] as const).map(
										(side) => [`--mobile-offset-${side}`, "16px"] as const,
									),
								]),
							),
							h.OnMouseEnter(Message.HoveredToaster()),
							...(model.isExpanded ? [] : [h.OnMouseMove(Message.HoveredToaster())]),
							h.OnMouseLeave(Message.LeftToaster()),
							h.OnPointerDown(() => Option.some(Message.PressedToaster())),
							h.OnPointerUp(() => Option.some(Message.ReleasedToaster())),
						],
						Array.map(model.toasts, (item, index) => toastView(h, model, item, index)),
					),
				],
	),
)
