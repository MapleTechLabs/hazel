// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The organization's pages with their wiring, for every host: the member directory and a profile. */
import { Component } from "@effect/ui"
import { Layer } from "effect"
import { CopyEmail, FindMemberDm, HomePage } from "./pages/HomePage"

/** Members: a DM is found in the synced rows; an email copies through the platform's clipboard. */
export const HostedHomePage = Component.provide(HomePage, Layer.mergeAll(FindMemberDm.layer, CopyEmail.layer))
