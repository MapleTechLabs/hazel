# iOS fully native

Status: plan v1 (2026-11-27), decided with the user. Builds on `docs/hazel-ui.md` (goal 2: iOS
screens fully native) and `docs/hazel-ui-phase4.md`.

## Why

TestFlight 3186.5 (`e4949db`) felt like a web page: sideways panning, selectable chrome text, desktop
menus on long press, no swipe back. The shipping app (`HazelHybrid`) is the web app in a `WKWebView`
whose native parts keyed off DOM annotations that only the Foldkit pages wrote: `data-ui`
(`ui/semantic.ts`, 10 files before, 1 now), `nativeContextMenu` (`page/chat/row-context.ts`), the
message list's `data-list-count` and `data-list-key` (`mount/message-list.ts`, deleted) and
`mobileBackLink`. Phase 4 replaced those pages with `hazel` ones, `readScreen()` returns null, the
shell never pushes (`ShellView.swift` `follow`), and everything is the web view at the root.

## Decisions (user, 2026-11-27)

1. **Full native now**, from the one shared codebase and the one design: shared `hazel` screens drawn
   by HazelUI's SwiftUI renderers, the script in JavaScriptCore. No more DOM capture.
2. **A new app target, `Hazel`**, built on HazelUI from the start. It reuses the hybrid's sign-in
   (`HostBridge.swift`), push (`PushNotifications.swift`) and keychain record, ships as `hazel.app`,
   and keeps a web view only as the fallback for a route with no native screen. `HazelHybrid` and its
   capture code (`web/list-capture.ts`, `semantic-tree.ts`, `look.ts`, `NativeList`, `NativeScreen`,
   `FramePool`) are deleted once `Hazel` covers the phone's flows.
3. **No stopgap** for the hybrid: TestFlight is not in use yet.
4. **The route table moves to shared code**, off `foldkit/route`, on Effect UI's `Route`; the web
   imports it from there.
5. **Everything native:** system navigation, menus, sheets, alerts, pickers and keyboard. Message
   text is selected the iOS way, through "Select Text" in the long-press menu; nothing else selects.

## What native means (the checklist each phase is held to)

- Navigation: `NavigationStack` push and pop, interactive swipe back (cancellable), system tab bar.
- Menus: long-press context menus, pull-down menus and pickers are `UIMenu`; confirms are alerts or
  confirmation dialogs; forms are sheets with detents.
- Scrolling: one axis, system momentum and rubber-banding, no JavaScript on the scroll path.
- No text selection outside "Select Text".
- Touch targets of 44pt or more; haptics from the renderers (selection, impact, success).
- Keyboard: the composer rides it, interactive dismiss, hardware keyboard Return sends.
- Safe areas, Dynamic Type where the recipes allow it, dark mode from the tokens.

## Running it

`bash apps/ios-hybrid/scripts/build-hazel.sh` builds `Hazel.app` (`OFFLINE=1` for the fallback's
offline web build). Against the local fixture (`bun apps/ios-hybrid/scripts/fixture-backend.ts`),
launch with `-HazelApiUrl http://127.0.0.1:4320 -HazelToken fixture`; without them it signs in to
Hazel's install through the system sheet. The script is `apps/ios-hybrid/script/entry.ts`.

## Phases

Every phase is a PR in a stack against `main`. Verify on the simulator through T3's device tools
(screenshots, recordings for gestures), record snapshot tests for each renderer touched, and keep
`bun run --cwd packages/ui test:web` green when a shared recipe moves.

| Phase | Work                                                                                                                                                                 | Proof                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| N0    | `Hazel` target: HazelUI, the JavaScriptCore runtime, sign-in and the keychain session from the hybrid, a web fallback view                                           | Sign-in reaches the native root; a fallback route shows                              |
| N1    | Route table in shared code; the native root: `hz:tabBar`, one `hz:navigation` per tab, route and stack in sync, deep links                                           | Recordings: tabs, push, swipe back, a cancelled swipe, a deep link                   |
| N2    | Chat: channel list, DMs, Activity as tab roots; the conversation and thread as shared screens (lanes PC8, PC9); native message and row menus; emoji picker; composer | Screenshots against the web; 120 Hz scroll logs; typing, sending, reactions, threads |
| N3    | Notifications, profile, More, the phone's settings pages; the stubs they need (choiceGroup, slider, banner, property, disclosure, ...); customers in the fallback    | Snapshot tests per renderer; screenshots per flow                                    |
| N4    | Push opening its screen, photo picker and uploads, share, lightbox                                                                                                   | A device run with G4 and G7 numbers                                                  |
| N5    | Walkthrough, delete `HazelHybrid`, TestFlight when the user asks                                                                                                     |                                                                                      |
