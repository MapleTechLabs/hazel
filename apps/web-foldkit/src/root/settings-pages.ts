// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The organization settings pages (PS1) with the browser's Layers: the app's one `ClientData`, the
 * clipboard and the settings uploads. Loaded as their own chunk (`native-pages.ts` imports it lazily).
 */
import { Component } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { ClipboardWeb } from "@hazel/client-data/web"
import { DebugPage } from "@hazel/shared-screens/settings/pages/debug/DebugPage"
import { GeneralPage } from "@hazel/shared-screens/settings/pages/general/GeneralPage"
import { InvitationsPage } from "@hazel/shared-screens/settings/pages/invitations/InvitationsPage"
import { TeamPage } from "@hazel/shared-screens/settings/pages/team/TeamPage"
import { Layer } from "effect"
import { clientData } from "~/db/client"
import { imageUploadsLayer } from "./image-uploads"

const layer = Layer.mergeAll(Layer.succeed(ClientData, clientData), ClipboardWeb, imageUploadsLayer)

export const SettingsTeamPage = Component.provide(TeamPage, layer)
export const SettingsInvitationsPage = Component.provide(InvitationsPage, layer)
export const SettingsGeneralPage = Component.provide(GeneralPage, layer)
export const SettingsDebugPage = DebugPage
