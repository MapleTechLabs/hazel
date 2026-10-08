import { Array } from "effect"
import { getTimezones } from "~/utils/timezone"
import { isAppleDevice } from "./aria/announcer"
import * as ComboBox from "./combo-box"
import { view as comboBoxView, type ViewInputs as ComboBoxViewInputs } from "./combo-box-view"

/**
 * Port of `components/ui/timezone-select.tsx`: a ComboBox over every IANA timezone. Embed it with
 * `h.submodel({ view: TimezoneSelect.view, viewInputs: TimezoneSelect.viewInputs(className) })`;
 * the chosen zone arrives as `ComboBox.OutMessage.ChangedSelection`.
 */
export const init = (config: { readonly id: string; readonly value?: string }): ComboBox.Model =>
	ComboBox.init({
		id: config.id,
		items: Array.map(getTimezones(), (zone) => ComboBox.item(zone.id, zone.label)),
		selectedKey: config.value,
		// Read once at init so update stays pure; a platform Flag from the page is the follow-up.
		isAppleDevice: isAppleDevice(),
	})

export const viewInputs = (
	options: { readonly className?: string; readonly placeholder?: string } = {},
): ComboBoxViewInputs => ({
	placeholder: options.placeholder ?? "Select timezone...",
	className: options.className,
	listBoxClassName: "max-h-60",
})

export const view = comboBoxView
