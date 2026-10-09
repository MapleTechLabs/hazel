# Foldkit review: icon accessibility (post-cutover proposal)

Status: proposal. Apply to `apps/web-foldkit` only after the cutover, when legacy `apps/web` is
retired. Until then Foldkit must keep legacy's ARIA tree, because `parity run --strict-a11y` fails
on any difference.

## Today (matches legacy on purpose)

- Every Nucleo icon (`src/icons/index.ts`, generated from `apps/web/src/components/icons`) renders
  a `<title>` and no `aria-hidden`, so the svg is exposed as `img "<title>"`. 35 of
  the 90 titled icons are titled `badge 13` (IconStar and IconHashtag have no title); the rest use
  the file name (`chevron-down`, `dots`, `download`).
- The title text joins the accessible name of its button or link: "chevron-down Channels",
  "badge 13 Browse channels", "Hazel Labs chevron-up-down", and an icon-only button is named after
  its icon alone ("badge 13", "dots", "close").
- Heroicons ports (calendar, date picker, tree chevron), the loader ring, video player icons,
  file-type icons and the live-message icons are already `aria-hidden`, like legacy.

The audit for this note (2026-10-09) found no Foldkit difference from legacy in icon titles,
`aria-hidden`, `title`, or icon-only button labels on the ported surfaces. Legacy surfaces that are
not ported (agent steps view, mobile date picker modal, Maple/Railway/OpenStatus config modals and
sections, the unused `AppNav`/`SidebarTrigger`/`UserStatusBadge`) were left out.

## Proposal

1. **Decorative by default.** In `scripts/generate-icons.ts`, stop emitting `<title>` and add
   `aria-hidden="true"` to the root, unless the call passes `title`. When `title` is passed, render
   `<title>` and `role="img"` and drop `aria-hidden`. Only the field validation state (`Valid`,
   `Validating...`) passes a title today, and it is meaningful.
2. **Every icon-only control gets an `aria-label`.** Once (1) lands these buttons have no name at
   all, so they must ship in the same change. The `button` helper could require `ariaLabel` when
   its only child is an icon, but a scene test sweep (`getByRole("button", { name })`) is enough.
3. **Icon-plus-text controls need nothing.** Their text becomes the whole name ("Channels",
   "Browse channels", "Hazel Labs").
4. Update scene tests and parity scenarios that locate controls by icon title (`"dots"`,
   `"badge 13"`, `"close"`), then re-baseline the ARIA snapshots in the same change.

## Icon-only buttons without a label today

| Where | Icon (name today) | Proposed `aria-label` |
| --- | --- | --- |
| `shell/channels-sidebar/tree.ts` `dotsMenuTrigger` (channel and DM rows) | dots | `Channel options` / `Conversation options` |
| `shell/channels-sidebar/menus.ts:138` (thread rows) | dots | `Thread options` |
| `shell/channels-sidebar/tree.ts` `sectionPlusButton` and the section "+" menu | plus | `Add channel` (Channels), `New message` (Direct Messages) |
| `shell/channels-sidebar/create-channel-hint.ts:32` | close | `Dismiss` |
| `shell/mobile.ts:104` mobile sidebar trigger | menu | `Open sidebar` |
| `chat/image-viewer.ts:187-190` toolbar | download, badge 13, external-link, close | `Download`, `Copy image URL`, `Open in browser`, `Close` |
| `composer/draft-view.ts` `removeButton` (attachment previews) | close | `Remove <file name>` |
| `page/home/view.ts:173` member row | badge 13 | `Message <name>` |
| `page/settings/invitations/view.ts:38` row menu | dots | `Invitation actions` |
| `page/settings/custom-emojis/view.ts:275` | badge 13 | `Delete :<name>:` |
| `page/settings/chat-sync/view.ts:202` (has `title`) | badge 13 | `Delete connection` |
| `page/channel-settings/overview/view.ts:45` icon picker | channel icon | `Change channel icon` |
| `page/channel-settings/overview/view.ts:47` | close | `Remove channel icon` |
| `page/channel-settings/connect/share-modal-view.ts:76` | close | `Clear workspace` |
| `page/channel-settings/integrations/row-menu.ts:42` | dots | `Subscription actions` |
| `page/channel-settings/integrations/webhooks.ts:87` | badge 13 / check | `Copy webhook URL` |
| `page/channel-settings/integrations/token-display.ts:29` | badge 13 / check | `Copy token`, `Copy URL` |
| `page/channel-settings/integrations/provider-card.ts:112` | badge 13 / check | `Copy URL` |
| `page/channel-settings/integrations/provider-card.ts:263` | badge 13 | `URL info` (it only toasts "Delete and reconnect to get a new URL") |

Buttons that already carry a label keep it ("Add reaction", "More actions", "Call", "Close thread",
"Remove invite", "Clear search", "Previous image", ...). With (1) their icon child stops adding an
`img` line to the tree.
