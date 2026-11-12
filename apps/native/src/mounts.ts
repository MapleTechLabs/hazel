/**
 * The web app's Mounts the native runtime runs, by how it runs them. A Mount not named here never
 * runs natively (its element is drawn, its DOM work skipped). The names are the web app's
 * `Mount.define` names; a renamed Mount drops out of this list silently, so keep them in step.
 */

/** Mounts that only observe geometry: they run against host-backed element proxies. */
export const OBSERVING_MOUNTS = [
	"ObserveMessageList",
	// An HTML render's frame mints its URL once its box comes near the window.
	"HtmlRenderFrameMounted",
]

/** The overlay Mounts run on proxies too: their helpers ask the host for the overlay itself. */
export const OVERLAY_MOUNTS = [
	"PortalMenu",
	"PortalSelect",
	"PortalComboBox",
	"PortalDatePicker",
	"PortalPickerPopover",
	"PortalCommandMenu",
	"PositionSubmenu",
	"AnchorTooltipPanel",
	// @foldkit/ui's, through the native anchor module.
	"AnchorPopover",
	"PortalPopoverBackdrop",
	"AnchorMenu",
	"PortalMenuBackdrop",
	"AnchorListbox",
	"PortalListboxBackdrop",
	"AnchorCombobox",
	"PortalComboboxBackdrop",
	"AnchorTooltip",
	// A Dialog shows itself (`Dom.showDialog`, which the render target answers) when it mounts.
	"AcquireResources",
]

/**
 * Mounts that only ask the host to act on their element (focus it, reveal it): they run when
 * they mount, as a hidden marker never gets a layout of its own.
 */
export const SCRIPT_MOUNTS = [
	// The open channel's sidebar row scrolls into view (`closest('[role="row"]')`).
	"ScrollActiveIntoView",
	// React's `autoFocus`.
	"AutoFocusMemberSearch",
	"AutoFocusOnboardingInput",
]

/**
 * Mounts that listen for delegated pointer events (hover, right-click) on their element, with the
 * selector of the elements they look for: the message list's hover shows a message's toolbar.
 */
export const POINTER_MOUNTS: ReadonlyMap<string, string> = new Map([
	["TrackMessageHover", "[data-id]"],
	// The message toolbar: its own element only (an empty selector matches nothing below it).
	["PlaceMessageToolbar", ""],
	// A context menu trigger hears right-clicks on itself.
	["CaptureContextMenu", ""],
])

/** Mounts that style their own element (`element.style.top`, `left`, `visibility`). */
export const STYLED_MOUNTS = ["PlaceMessageToolbar"]

/** The editor Mount: it runs on the headless DOM (`composer.ts`), not on a proxy. */
export const EDITOR_MOUNT = "MountEditor"

/** Every Mount that runs on element proxies. */
export const PROXY_MOUNTS = new Set([
	...OBSERVING_MOUNTS,
	...OVERLAY_MOUNTS,
	...SCRIPT_MOUNTS,
	...POINTER_MOUNTS.keys(),
])

/** The proxy Mounts that run as soon as they mount, without waiting for a layout. */
export const IMMEDIATE_MOUNTS = new Set([...OVERLAY_MOUNTS, ...SCRIPT_MOUNTS, ...POINTER_MOUNTS.keys()])
