// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * View pieces the Signals list, the template picker and the rule editor share (today's
 * `page/customers/settings/signals/parts.ts` and `settings/shared.ts`), on the hazel vocabulary.
 */
import type * as Customers from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { SEVERITY_LABEL } from "../../ui/badges"
import { TEMPLATE_ICON } from "./describe"

/** The template's glyph on a tile. */
export const templateTile = <Msg>(
	h: Hazel.H<Msg>,
	template: Customers.SignalTemplate,
	size: "regular" | "small" | "xsmall" = "small",
) => h.iconTile.name(TEMPLATE_ICON[template]).size(size)

/** Shown to members on every settings page: they can look, admins change. */
export const readOnlyNotice = <Msg>(h: Hazel.H<Msg>, what: string) =>
	h.banner.tone("info").description(`Only admins and owners can change ${what}. You can look around.`)

/** A card under its header: the title, and an aside at the header's end. */
export const panel = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{ key: string; title: string; description?: string; aside?: Hazel.NoTextInput<Msg> }>,
	...children: ReadonlyArray<Hazel.NoTextInput<Msg>>
) =>
	h.frame.key(options.key).children(
		h.stack.density("regular").children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("compact")
				.children(
					h.stack
						.density("tight")
						.children(
							h.heading.level("3").children(options.title),
							options.description === undefined
								? null
								: h.text.role("caption").tone("muted").children(options.description),
						),
					h.spacer,
					options.aside ?? null,
				),
			...children,
		),
	)

export const SEVERITIES = ["low", "medium", "high"] as const satisfies ReadonlyArray<Customers.SignalSeverity>

/** `Low  Medium  High` as a segmented control. */
export const severityPicker = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		selected: Customers.SignalSeverity
		isDisabled: boolean
		onSelect: (severity: Customers.SignalSeverity) => Msg
	}>,
) =>
	// HAZEL-GAP(pk7-severity-segments): today each segment leads with its severity bars glyph.
	h.choiceGroup
		.label("Severity")
		.labelHidden()
		.style("segmented")
		.options(SEVERITIES.map((severity) => ({ value: severity, label: SEVERITY_LABEL[severity] })))
		.selected([options.selected])
		.disabled(options.isDisabled)
		.on("change", ({ selected }) => {
			const picked = SEVERITIES.find(
				(severity) => selected.includes(severity) && severity !== options.selected,
			)
			return options.onSelect(picked ?? options.selected)
		})

/** The list page's href, and a rule's. */
export const signalsHref = (orgSlug: string) => `/${orgSlug}/customers/settings/signals`
export const ruleHref = (orgSlug: string, ruleId: string) => `${signalsHref(orgSlug)}/${ruleId}`
export const newRuleHref = (orgSlug: string, template: Customers.SignalTemplate) =>
	`${signalsHref(orgSlug)}/new?template=${template}`
export const sourceHref = (orgSlug: string, provider: Customers.CustomerProvider) =>
	`/${orgSlug}/customers/settings/sources/${provider}`
