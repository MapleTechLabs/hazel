// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What a page asks the app for, one Command each (today's `PageOutMessage`,
 * `web-foldkit/src/page/out-message.ts`). Each is silent to the page: the host decides what it
 * means, through the `send` it gives `appRequestsLayer`.
 */
import { Command, Component, UiSchema } from "@effect/ui"
import { Theme } from "@hazel/domain/models"
import { OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Schema } from "effect"
import { Overrides } from "../lib/keybindings/keymap"

/** A toast (sonner's options): a later one with the same `id` replaces it in place. */
export const AppToast = Schema.Struct({
	intent: Schema.Literals(["success", "error", "info", "warning", "loading"]),
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	id: Schema.optionalKey(Schema.String),
	/** A button that reports `key` to the app and closes the toast. */
	action: Schema.optionalKey(
		Schema.Struct({ label: Schema.String, key: Schema.Literals(["InstallUpdate"]) }),
	),
	/** Stays until dismissed. */
	isSticky: Schema.optionalKey(Schema.Boolean),
})
export type AppToast = typeof AppToast.Type

export const ThemePreference = Schema.Struct({
	mode: Schema.Literals(["system", "light", "dark"]),
	customization: Schema.Struct({
		primary: Theme.HexColor,
		grayPalette: Theme.GrayPalette,
		radius: Theme.RadiusPreset,
	}),
})
export type ThemePreference = typeof ThemePreference.Type

export const SoundSettings = Schema.Struct({
	enabled: Schema.Boolean,
	volume: Schema.Finite,
	soundFile: Schema.Literals(["notification01", "notification03"]),
	cooldownMs: Schema.Finite,
})
export type SoundSettings = typeof SoundSettings.Type

export const PalettePage = Schema.Literals([
	"home",
	"search",
	"join-channel",
	"create-channel",
	"status",
	"appearance",
])
export type PalettePage = typeof PalettePage.Type

/** A modal by its kind in the host's registry, with that kind's fields; the host checks them. */
export interface ModalRequest {
	readonly _tag: string
	readonly [field: string]: unknown
}
export const ModalRequest = Schema.declare(
	(input: unknown): input is ModalRequest =>
		typeof input === "object" && input !== null && typeof (input as { _tag?: unknown })._tag === "string",
	{ identifier: "ModalRequest" },
)

const fields = {
	/** An in-app href (`/acme/chat/c1`); `toast` shows with the navigation. */
	Navigate: { href: Schema.String, replace: Schema.Boolean, toast: Schema.optionalKey(AppToast) },
	/** A full load of `href`, so every query and sync starts over (after joining a workspace). */
	LoadPage: { href: Schema.String },
	History: { direction: Schema.Literals(["Back", "Forward"]) },
	ShowToast: { toast: AppToast },
	OpenModal: { modal: ModalRequest },
	OpenCommandPalette: { page: PalettePage },
	SignOut: {},
	/** The app creates the DM and opens it, so its toast resolves after the page is gone. */
	CreateDm: { organizationId: OrganizationId, orgSlug: Schema.String, userId: UserId, name: Schema.String },
	SetTheme: { preference: ThemePreference },
	SetSoundSettings: { settings: SoundSettings },
	SetKeybindings: { overrides: Overrides },
	/** `user.me` again (after an avatar change), with the toast that goes with it. */
	RefreshCurrentUser: { toast: Schema.optionalKey(AppToast) },
	CheckForUpdate: {},
	InstallUpdate: {},
} as const

/** Every request, as the host receives it. */
export const AppRequest = UiSchema.TaggedEnum(fields)
export type AppRequest = typeof AppRequest.Type

export class Navigate extends Command.Service<Navigate>()("hazel/app/Navigate", {
	args: fields.Navigate,
	success: Component.Noop,
}) {}

export class LoadPage extends Command.Service<LoadPage>()("hazel/app/LoadPage", {
	args: fields.LoadPage,
	success: Component.Noop,
}) {}

export class History extends Command.Service<History>()("hazel/app/History", {
	args: fields.History,
	success: Component.Noop,
}) {}

export class ShowToast extends Command.Service<ShowToast>()("hazel/app/ShowToast", {
	args: fields.ShowToast,
	success: Component.Noop,
}) {}

export class OpenModal extends Command.Service<OpenModal>()("hazel/app/OpenModal", {
	args: fields.OpenModal,
	success: Component.Noop,
}) {}

export class OpenCommandPalette extends Command.Service<OpenCommandPalette>()(
	"hazel/app/OpenCommandPalette",
	{
		args: fields.OpenCommandPalette,
		success: Component.Noop,
	},
) {}

export class SignOut extends Command.Service<SignOut>()("hazel/app/SignOut", {
	args: fields.SignOut,
	success: Component.Noop,
}) {}

export class CreateDm extends Command.Service<CreateDm>()("hazel/app/CreateDm", {
	args: fields.CreateDm,
	success: Component.Noop,
}) {}

export class SetTheme extends Command.Service<SetTheme>()("hazel/app/SetTheme", {
	args: fields.SetTheme,
	success: Component.Noop,
}) {}

export class SetSoundSettings extends Command.Service<SetSoundSettings>()("hazel/app/SetSoundSettings", {
	args: fields.SetSoundSettings,
	success: Component.Noop,
}) {}

export class SetKeybindings extends Command.Service<SetKeybindings>()("hazel/app/SetKeybindings", {
	args: fields.SetKeybindings,
	success: Component.Noop,
}) {}

export class RefreshCurrentUser extends Command.Service<RefreshCurrentUser>()(
	"hazel/app/RefreshCurrentUser",
	{
		args: fields.RefreshCurrentUser,
		success: Component.Noop,
	},
) {}

export class CheckForUpdate extends Command.Service<CheckForUpdate>()("hazel/app/CheckForUpdate", {
	args: fields.CheckForUpdate,
	success: Component.Noop,
}) {}

export class InstallUpdate extends Command.Service<InstallUpdate>()("hazel/app/InstallUpdate", {
	args: fields.InstallUpdate,
	success: Component.Noop,
}) {}

/**
 * The same requests from inside a Command body, for feedback that must outlive the component that
 * ran it (a modal that closed before its write answered still toasts).
 */
export class AppRequests extends Context.Service<
	AppRequests,
	{ readonly send: (request: AppRequest) => Effect.Effect<void> }
>()("hazel/app/AppRequests") {}

/** Hands each request to `send` and answers nothing: a page never waits on the app. */
const sending =
	(send: (request: AppRequest) => void) =>
	<Args>(toRequest: (args: Args) => AppRequest) =>
	(args: Args) =>
		Effect.sync(() => {
			send(toRequest(args))
			return Component.noop
		})

/** Every request Command, each sent to the host as an `AppRequest`. */
export const appRequestsLayer = (send: (request: AppRequest) => void) => {
	const to = sending(send)
	return Layer.mergeAll(
		Navigate.toLayer(Effect.succeed(to(AppRequest.Navigate))),
		LoadPage.toLayer(Effect.succeed(to(AppRequest.LoadPage))),
		History.toLayer(Effect.succeed(to(AppRequest.History))),
		ShowToast.toLayer(Effect.succeed(to(AppRequest.ShowToast))),
		OpenModal.toLayer(Effect.succeed(to(AppRequest.OpenModal))),
		OpenCommandPalette.toLayer(Effect.succeed(to(AppRequest.OpenCommandPalette))),
		SignOut.toLayer(Effect.succeed(to(() => AppRequest.SignOut()))),
		CreateDm.toLayer(Effect.succeed(to(AppRequest.CreateDm))),
		SetTheme.toLayer(Effect.succeed(to(AppRequest.SetTheme))),
		SetSoundSettings.toLayer(Effect.succeed(to(AppRequest.SetSoundSettings))),
		SetKeybindings.toLayer(Effect.succeed(to(AppRequest.SetKeybindings))),
		RefreshCurrentUser.toLayer(Effect.succeed(to(AppRequest.RefreshCurrentUser))),
		CheckForUpdate.toLayer(Effect.succeed(to(() => AppRequest.CheckForUpdate()))),
		InstallUpdate.toLayer(Effect.succeed(to(() => AppRequest.InstallUpdate()))),
		Layer.succeed(AppRequests, { send: (request) => Effect.sync(() => send(request)) }),
	)
}
