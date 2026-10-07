import type { Html, HtmlBuilder } from "foldkit/html"
import { type ConfigOption, getBrandfetchIcon, type Integration } from "~/lib/integrations/__data"
import { button } from "../../../../ui/button"
import * as Field from "../../../../ui/field"
import { input, inputGroup } from "../../../../ui/input"
import { sectionLabelRoot } from "../../../../ui/section-label"
import { switchControl } from "../../../../ui/switch"
import { CHECK, spinner, strokeIcon } from "../shared/view"
import { Message } from "./message"
import type { Model } from "./model"

/** The connection states, API key form and config rows of `$integrationId.tsx`. */

type H = HtmlBuilder<Message>

const LINK_ICON =
	"M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
const SLIDERS_ICON =
	"M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"

const brandIcon = (h: H, integration: Integration) =>
	h.img([
		h.Attribute(
			"src",
			getBrandfetchIcon(integration.logoDomain, { theme: "light", type: integration.logoType }),
		),
		h.Attribute("alt", ""),
		h.Class("size-4 rounded object-contain"),
	])

const centered = (h: H, icon: Html, title: string | Array<string>, body: Array<string>, extra: Array<Html>) =>
	h.div(
		[h.Class("flex flex-col items-center gap-4 py-4 text-center")],
		[
			h.div([h.Class("flex size-14 items-center justify-center rounded-xl bg-bg-muted")], [icon]),
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.p(
						[h.Class("font-medium text-fg text-sm")],
						typeof title === "string" ? [title] : title,
					),
					h.p([h.Class("text-muted-fg text-sm")], body),
				],
			),
			...extra,
		],
	)

export const disconnectedState = (h: H, integration: Integration, isConnecting: boolean): Html =>
	centered(
		h,
		strokeIcon(h, { className: "size-6 text-muted-fg", strokeWidth: "1.5", d: LINK_ICON }),
		["Connect your ", integration.name, " account"],
		["You'll be redirected to ", integration.name, " to authorize the connection."],
		[
			button(
				h,
				{
					intent: "primary",
					size: "md",
					className: "mt-2",
					onPress: Message.ClickedConnect(),
					isDisabled: isConnecting,
					attributes: [h.Style({ backgroundColor: integration.brandColor })],
				},
				isConnecting
					? [spinner(h, "size-4 animate-spin"), "Connecting..."]
					: [brandIcon(h, integration), "Connect with ", integration.name],
			),
		],
	)

export const verifyingState = (h: H, integration: Integration): Html =>
	centered(
		h,
		spinner(h, "size-6 animate-spin text-muted-fg"),
		"Verifying connection...",
		["Please wait while we verify your ", integration.name, " connection."],
		[],
	)

export const connectedState = (
	h: H,
	integration: Integration,
	model: Model,
	options: { readonly canConfigure: boolean },
): Html => {
	const connection = model.connection
	const showConfigureButton =
		options.canConfigure && integration.id === "github" && connection?.hasInstallationId
	return h.div(
		[h.Class("flex items-center justify-between gap-4")],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					h.div(
						[h.Class("flex size-10 items-center justify-center rounded-xl bg-success-subtle")],
						[
							strokeIcon(h, {
								className: "size-5 text-success-subtle-fg",
								strokeWidth: "2",
								d: CHECK,
							}),
						],
					),
					h.div(
						[h.Class("flex flex-col gap-0.5")],
						[
							h.p(
								[h.Class("font-medium text-fg text-sm")],
								["Connected to ", integration.name],
							),
							...(connection?.externalAccountName
								? [h.p([h.Class("text-muted-fg text-xs")], [connection.externalAccountName])]
								: []),
						],
					),
				],
			),
			showConfigureButton
				? button(
						h,
						{
							intent: "secondary",
							size: "sm",
							onPress: Message.ClickedConnect(),
							isDisabled: model.isConnecting,
						},
						model.isConnecting
							? [spinner(h, "size-4 animate-spin"), "Redirecting..."]
							: [
									strokeIcon(h, { className: "size-4", strokeWidth: "2", d: SLIDERS_ICON }),
									"Configure on GitHub",
								],
					)
				: button(
						h,
						{
							intent: "danger",
							size: "sm",
							onPress: Message.ClickedDisconnect(),
							isDisabled: model.isDisconnecting,
						},
						[model.isDisconnecting ? "Disconnecting..." : "Disconnect"],
					),
		],
	)
}

const apiField = (
	h: H,
	options: {
		readonly id: string
		readonly label: string
		readonly type: string
		readonly placeholder: string
		readonly value: string
		readonly onInput: (value: string) => Message
		readonly hint: Array<string>
	},
): Html =>
	h.div(
		[h.Class("flex flex-col gap-1.5")],
		[
			h.label([h.For(options.id), h.Class("font-medium text-fg text-sm")], [options.label]),
			inputGroup(h, {}, [
				input(h, {
					placeholder: options.placeholder,
					className: "text-sm",
					attributes: [
						h.Id(options.id),
						h.Type(options.type),
						h.Attribute("autocomplete", "off"),
						h.Value(options.value),
						h.OnInput(options.onInput),
					],
				}),
			]),
			h.p([h.Class("text-muted-fg text-xs")], options.hint),
		],
	)

export const apiKeyConnectionForm = (h: H, integration: Integration, model: Model): Html =>
	h.form(
		[h.Class("flex flex-col gap-5 py-2"), h.OnSubmit(Message.SubmittedApiKeyForm())],
		[
			apiField(h, {
				id: "api-token",
				label: "Bearer Token",
				type: "password",
				placeholder: "Enter your API token",
				value: model.apiToken,
				onInput: (value) => Message.ChangedApiToken({ value }),
				hint: ["You can find this in your ", integration.name, " API settings."],
			}),
			apiField(h, {
				id: "api-base-url",
				label: "Base URL",
				type: "url",
				placeholder: "https://connect.craft.do/links/{linkId}/api/v1",
				value: model.apiBaseUrl,
				onInput: (value) => Message.ChangedApiBaseUrl({ value }),
				hint: ["The API endpoint URL for your space."],
			}),
			button(
				h,
				{
					intent: "primary",
					size: "md",
					className: "self-start",
					isDisabled: model.isConnecting || !model.apiToken.trim() || !model.apiBaseUrl.trim(),
					attributes: [h.Type("submit"), h.Style({ backgroundColor: integration.brandColor })],
				},
				model.isConnecting
					? [spinner(h, "size-4 animate-spin"), "Connecting..."]
					: [brandIcon(h, integration), "Connect"],
			),
		],
	)

export const configOptionRow = (h: H, option: ConfigOption, isEnabled: boolean): Html =>
	h.keyed("div")(
		option.id,
		[h.Class("flex items-center justify-between gap-4 px-5 py-4")],
		[
			sectionLabelRoot(h, { size: "sm", title: option.label, description: option.description }),
			option.type === "toggle"
				? Field.label(h, { elementType: "span" }, [
						switchControl(
							h,
							{
								id: `config-option-${option.id}`,
								isSelected: isEnabled,
								onChange: (isSelected) =>
									Message.ToggledConfigOption({ optionId: option.id, isSelected }),
							},
							[],
						),
					])
				: inputGroup(h, { className: "w-48" }, [
						input(h, { placeholder: option.placeholder, className: "text-sm", isDisabled: true }),
					]),
		],
	)
