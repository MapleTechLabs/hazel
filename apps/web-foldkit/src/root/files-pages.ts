// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel's Files and All media pages with the browser's Layers: the app's one `ClientData` and
 * `FilesHost`. Loaded as their own chunk (`children.ts` imports this module lazily).
 */
import { Component } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { FilesPage } from "@hazel/shared-screens/chat/pages/files/FilesPage"
import { MediaPage } from "@hazel/shared-screens/chat/pages/files/media/MediaPage"
import { Layer } from "effect"
import { clientData } from "~/db/client"
import { filesHostLayer } from "./files-host"

const layer = Layer.mergeAll(Layer.succeed(ClientData, clientData), filesHostLayer)

export const ShellFilesPage = Component.provide(FilesPage, layer)

export const ShellMediaPage = Component.provide(MediaPage, layer)
