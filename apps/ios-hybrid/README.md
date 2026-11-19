# Hazel for iOS (hybrid)

The web app (`apps/web-foldkit`) as the one source of the UI, in a SwiftUI shell that draws its hot
paths natively (see `docs/cross-platform-ui.md`):

- **Screens** the page annotates (`data-ui`, `ui/semantic.ts`), like the channel list, are drawn as native
  views in the web's own look (`web/semantic-tree.ts`, `web/look.ts`, `NativeScreen.swift`).
  Everything else shows the page itself.
- **The message list** is native: the page lays out every row (`SystemUi.drawsLists`), each is
  captured as a display list (`web/list-capture.ts`) and drawn into a bitmap off the main thread
  (`ListModel.swift`, `NativeList.swift`). HTML renders show live over their rows (`FramePool.swift`).
- **The composer** is a native Liquid Glass input that writes into the web's editor
  (`web/composer-capture.ts`, `NativeComposer.swift`).
- **Menus, tab bar, swipe-back, haptics** are the system's, from the page's islands and
  `__HAZEL_SYSTEM_UI__`.

The page is one inlined `index.html` loaded on the web app's origin (`https://app.hazel.sh`), so the
API's CORS and sign-in take it. WebKit loads nothing from the bundle's own scheme into an https page.
It signs in as the native client through the system's sign-in sheet; the session is kept in the
keychain (`web/host.ts`, `HostBridge.swift`).

```sh
bun run ios                                  # live: web build, Xcode project (xcodegen), install, launch
OFFLINE=1 bash scripts/build.sh && OFFLINE=1 bash scripts/run.sh
                                             # the offline fixture (3,000-message #engineering)
BUILD=<n> bash scripts/release.sh            # TestFlight (HazelChat, `hazel.app`); BUILD above the latest
```

An HTML render in the offline #general: serve a page with
`bun apps/native/scripts/serve-fixture-html.ts page.html 4310` and build with
`VITE_FIXTURE_HTML=http://127.0.0.1:4310/html-renders/fixture`.

Debug the page with Safari's Develop menu (the web view is inspectable); the page's console is in
the app's log (subsystem `sh.hazel.hybrid`), as are frame drops (`[frames]`).
