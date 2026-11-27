// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The auth frame (today's `page/auth/layout.ts` `authFrame`): the brand panel beside one centred card
 * whose header is the page's title and subtitle. Shared by the auth pages and the pages that borrow
 * the frame (invite, and PA2's join, OAuth consent, bot install).
 */
import { BrandPanel } from "@hazel/ui/extensions/BrandPanel"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { MessageTone, UserErrorMessage } from "../domain/AuthFailure"

export const DEFAULT_TAGLINE = "A calm place for your team to talk, decide and ship."

/** The app's root, where the logo and the dead-end pages' links go. */
export const HOME_HREF = "/"

/** Where the web app keeps the panel's seasonal pictures (`public/images/onboarding`). */
const PICTURES = "/images/onboarding"

export interface FrameOptions {
	readonly title: string
	readonly subtitle: string
	/** The panel's card text; `null` draws the panel without it. */
	readonly tagline?: string | null
}

/**
 * The frame around `children`, the card's rows under its heading.
 * HAZEL-GAP(p4-auth-compact-logo): on a phone today's frame shows the logo and wordmark above the
 * card; `centered` hides the `aside` there and has no slot above the header.
 */
export const authFrame = <Msg>(h: Hazel.H<Msg>, options: FrameOptions, ...children: ReadonlyArray<unknown>) =>
	h.screen
		.surface("centered")
		.title(options.title)
		.subtitle(options.subtitle)
		.aside(
			h.extension(BrandPanel, {
				pictures: PICTURES,
				homeHref: HOME_HREF,
				tagline: options.tagline === undefined ? DEFAULT_TAGLINE : options.tagline,
			}),
		)
		.children(...(children as Array<never>))

/** A frame with no rows: a page that only waits (today's loader under no heading). */
export const authWaiting = <Msg>(h: Hazel.H<Msg>, label: string) =>
	h.screen
		.surface("centered")
		.aside(h.extension(BrandPanel, { pictures: PICTURES, homeHref: HOME_HREF, tagline: DEFAULT_TAGLINE }))
		.children(h.progress.style("spinner").label(label))

/** A failure (or a notice) under the form, as one line: `title. description`. */
export const messageText = <Msg>(h: Hazel.H<Msg>, message: UserErrorMessage, tone: MessageTone = "danger") =>
	h.text
		.role("label")
		.tone(tone)
		.children(
			message.description === undefined ? message.title : `${message.title}. ${message.description}`,
		)

/**
 * The underlined link an auth card ends on (`Go to Hazel`, `Back to sign in`).
 * HAZEL-GAP(p4-link-quiet): today's is `text-fg text-sm underline`; `link` has only the accent style.
 */
export const textLink = <Msg>(h: Hazel.H<Msg>, label: string, href: string) => h.link.label(label).href(href)

export const homeLink = <Msg>(h: Hazel.H<Msg>) => textLink(h, "Go to Hazel", HOME_HREF)
