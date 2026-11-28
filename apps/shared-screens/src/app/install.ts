/**
 * The install the app talks to, beyond its API (`ClientDataConfig`): where uploads without their own
 * URL live, and the link-preview worker. One per run; another install starts the app over.
 */
import { Context } from "effect"

export class Install extends Context.Service<
	Install,
	{ readonly cdnUrl: string; readonly linkPreviewUrl: string }
>()("hazel/app/Install") {}
