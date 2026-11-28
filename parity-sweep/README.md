# Parity sweep, 2026-11-28

`compare-pages.ts --baseline` over all 129 parity pages, run from branch `t3/fix-channel-list-layout`.
Each strip: **old Foldkit page | Hazel UI page | diff** (red = differing pixels).
Sorted by the largest share of differing pixels. Tolerance is a channel delta of 5, so font
antialiasing alone puts nearly every page over it; the percentage is the signal.

| Page | light 1180 | dark 1180 | light 390 | dark 390 | Notes |
|---|---|---|---|---|---|
| [channel-header-customer](#channel-header-customer) | 13.8% | 16.9% | 51.6% | 50.8% |  |
| [customers-signals-picker](#customers-signals-picker) | 51.1% | 46.1% | 14.8% | 14.8% |  |
| [customers-attention-mark-done](#customers-attention-mark-done) | 21.8% | 19.7% | 50.4% | 50.0% |  |
| [customers-list-filter](#customers-list-filter) | 10.4% | 38.2% | 13.7% | 49.3% |  |
| [modal-edit-bot-error](#modal-edit-bot-error) | 15.7% | 15.8% | 49.2% | 49.2% |  |
| [modal-edit-bot](#modal-edit-bot) | 14.5% | 14.5% | 46.6% | 46.6% |  |
| [customers-list-columns](#customers-list-columns) | 8.1% | 21.9% | 18.8% | 45.5% |  |
| [customers-signal-rule](#customers-signal-rule) | 30.6% | 30.6% | 37.3% | 41.1% |  |
| [modal-create-bot-error](#modal-create-bot-error) | 15.6% | 15.6% | 39.1% | 39.1% |  |
| [customers-sources-connect](#customers-sources-connect) | 34.2% | 34.3% | 27.6% | 35.7% |  |
| [modal-create-bot](#modal-create-bot) | 14.1% | 14.1% | 35.3% | 35.3% |  |
| [modal-create-organization-error](#modal-create-organization-error) | 15.3% | 12.8% | 35.1% | 34.8% |  |
| [chat-files-media](#chat-files-media) | 34.4% | 34.4% | 0.4% | 0.4% |  |
| [assistant](#assistant) | 5.9% | 9.0% | 20.2% | 31.6% |  |
| [modal-request-integration-error](#modal-request-integration-error) | 17.1% | 14.9% | 31.2% | 30.8% |  |
| [customers-settings-feature-flags-open](#customers-settings-feature-flags-open) | 31.0% | 31.0% | 18.6% | 18.6% |  |
| [modal-create-organization](#modal-create-organization) | 12.5% | 10.3% | 29.4% | 29.2% |  |
| [chat-migration](#chat-migration) | 17.3% | 12.3% | 28.4% | 28.1% |  |
| [channel-settings-connect-share](#channel-settings-connect-share) | 14.0% | 9.5% | 28.1% | 27.8% |  |
| [modal-set-status](#modal-set-status) | 16.2% | 13.8% | 27.8% | 27.9% |  |
| [customers-attention](#customers-attention) | 17.3% | 17.1% | 27.8% | 26.9% |  |
| [customers-settings-sla-editor](#customers-settings-sla-editor) | 19.3% | 19.3% | 27.6% | 27.0% |  |
| [settings-integrations](#settings-integrations) | 22.2% | 12.1% | 27.5% | 16.6% |  |
| [modal-create-channel-error](#modal-create-channel-error) | 13.4% | 10.9% | 26.2% | 25.8% |  |
| [settings-general](#settings-general) | 15.2% | 13.0% | 25.8% | 22.3% |  |
| [layout-settings](#layout-settings) | 15.3% | 13.0% | 25.8% | 22.3% |  |
| [my-settings-notifications](#my-settings-notifications) | 16.5% | 16.6% | 25.5% | 25.6% |  |
| [customer-detail](#customer-detail) | 25.1% | 25.0% | 19.5% | 19.4% |  |
| [modal-request-integration](#modal-request-integration) | 15.5% | 13.3% | 25.0% | 25.0% |  |
| [modal-keyboard-shortcuts](#modal-keyboard-shortcuts) | 24.5% | 20.1% | 12.4% | 14.5% |  |
| [auth-register](#auth-register) | 3.7% | 3.7% | 23.6% | 23.5% |  |
| [palette-search](#palette-search) | 16.0% | 13.4% | 22.9% | 22.1% |  |
| [modal-install-bot](#modal-install-bot) | 13.2% | 8.4% | 21.9% | 21.8% |  |
| [settings-integrations-your-apps-menu](#settings-integrations-your-apps-menu) | 3.0% | 4.2% | 17.9% | 21.9% |  |
| [auth-register-invalid](#auth-register-invalid) | 5.3% | 5.3% | 21.7% | 21.6% |  |
| [settings-chat-sync](#settings-chat-sync) | 21.6% | 21.4% | 16.6% | 17.1% |  |
| [modal-create-channel](#modal-create-channel) | 11.9% | 9.2% | 21.5% | 21.3% |  |
| [customers-attention-preview](#customers-attention-preview) | 20.5% | 19.8% | 15.1% | 18.7% |  |
| [bot-install](#bot-install) | 4.5% | 4.5% | 20.4% | 20.5% |  |
| [auth-register-error](#auth-register-error) | 3.3% | 3.2% | 20.4% | 20.4% |  |
| [composer](#composer) | 8.8% | 19.4% | 0.5% | 0.5% |  |
| [my-settings-appearance](#my-settings-appearance) | 17.7% | 18.8% | 13.5% | 13.5% |  |
| [customers-signals](#customers-signals) | 13.2% | 13.0% | 18.2% | 18.4% |  |
| [customers-attention-done](#customers-attention-done) | 16.2% | 16.2% | 18.4% | 16.4% |  |
| [modal-email-invite](#modal-email-invite) | 15.1% | 12.8% | 17.6% | 17.4% |  |
| [emoji-picker](#emoji-picker) | 7.4% | 17.5% | 2.6% | 2.6% |  |
| [palette-filter](#palette-filter) | 13.2% | 10.7% | 17.4% | 16.6% |  |
| [customers-sources](#customers-sources) | 10.9% | 10.9% | 16.7% | 16.7% |  |
| [customers-attention-snoozed](#customers-attention-snoozed) | 15.0% | 14.9% | 16.3% | 15.4% |  |
| [oauth-authorize](#oauth-authorize) | 5.3% | 5.3% | 15.8% | 15.8% |  |
| [modal-regenerate-bot-token](#modal-regenerate-bot-token) | 0.1% | 0.1% | 15.6% | 15.6% |  |
| [modal-feedback-error](#modal-feedback-error) | 11.0% | 8.4% | 15.6% | 15.3% |  |
| [settings-custom-emojis](#settings-custom-emojis) | 6.5% | 9.3% | 9.7% | 15.2% |  |
| [settings-integrations-installed-confirm](#settings-integrations-installed-confirm) | 10.2% | 9.9% | 14.9% | 14.9% |  |
| [settings-integrations-your-apps](#settings-integrations-your-apps) | 7.9% | 7.8% | 14.4% | 14.5% |  |
| [modal-create-dm](#modal-create-dm) | 9.8% | 7.4% | 14.3% | 14.5% |  |
| [join](#join) | 2.9% | 2.6% | 14.2% | 13.5% |  |
| [modal-delete-bot](#modal-delete-bot) | 6.9% | 3.5% | 14.2% | 14.1% |  |
| [select-organization-empty](#select-organization-empty) | 8.2% | 8.2% | 13.8% | 13.7% |  |
| [customers-overview](#customers-overview) | 13.5% | 13.4% | 6.5% | 6.6% |  |
| [settings-integrations-installed](#settings-integrations-installed) | 8.1% | 7.9% | 12.8% | 12.9% |  |
| [onboarding-profile](#onboarding-profile) | 7.9% | 7.9% | 12.4% | 12.4% |  |
| [settings-groups](#settings-groups) | 6.2% | 6.1% | 12.2% | 12.2% |  |
| [chat-files](#chat-files) | 11.9% | 11.9% | 3.1% | 3.1% |  |
| [home](#home) | 5.1% | 5.2% | 11.6% | 11.9% |  |
| [modal-feedback](#modal-feedback) | 10.1% | 7.5% | 11.7% | 11.8% |  |
| [customers-settings-sla](#customers-settings-sla) | 11.3% | 11.3% | 11.8% | 11.7% |  |
| [settings-integrations-marketplace](#settings-integrations-marketplace) | 11.4% | 11.3% | 5.4% | 5.3% |  |
| [message-profile](#message-profile) | 0.3% | 0.3% | 11.3% | 11.3% |  |
| [sign-in-error](#sign-in-error) | 1.6% | 1.6% | 11.1% | 11.3% |  |
| [message-reactions](#message-reactions) | 4.2% | 4.4% | 11.1% | 11.2% |  |
| [settings-team](#settings-team) | 2.1% | 2.2% | 10.5% | 10.5% |  |
| [layout-channel-settings](#layout-channel-settings) | 3.0% | 3.0% | 10.1% | 10.0% |  |
| [channel-settings-connect-shared](#channel-settings-connect-shared) | 2.0% | 1.8% | 10.0% | 10.0% |  |
| [palette-recents](#palette-recents) | 3.9% | 3.1% | 9.7% | 9.9% |  |
| [channel-header-bell](#channel-header-bell) | 2.0% | 2.7% | 7.9% | 9.5% |  |
| [channel-header-pins](#channel-header-pins) | 3.4% | 2.8% | 9.3% | 8.0% |  |
| [modal-create-section-error](#modal-create-section-error) | 9.2% | 6.8% | 0.1% | 0.1% | not mounted at 390 |
| [sign-in](#sign-in) | 1.3% | 1.3% | 8.3% | 8.5% |  |
| [sign-up](#sign-up) | 1.3% | 1.3% | 8.3% | 8.5% |  |
| [modal-join-channel](#modal-join-channel) | 7.2% | 4.8% | 8.4% | 8.5% |  |
| [layout-customers](#layout-customers) | 0.1% | 0.1% | 8.1% | 8.0% | not mounted at 390 |
| [channel-settings-overview-customer](#channel-settings-overview-customer) | 4.6% | 4.6% | 8.1% | 8.0% |  |
| [modal-create-section](#modal-create-section) | 8.1% | 6.0% | 0.1% | 0.1% | not mounted at 390 |
| [channel-settings-overview](#channel-settings-overview) | 4.5% | 4.5% | 7.9% | 7.8% |  |
| [settings-connect-invites](#settings-connect-invites) | 6.2% | 6.2% | 7.6% | 7.6% |  |
| [chat-index](#chat-index) | 7.5% | 7.5% | 0.1% | 0.1% | not mounted at 390 |
| [customers-support](#customers-support) | 6.1% | 6.1% | 7.4% | 7.4% |  |
| [onboarding](#onboarding) | 4.8% | 4.8% | 7.4% | 7.3% |  |
| [join-not-found](#join-not-found) | 1.7% | 1.7% | 7.0% | 7.0% |  |
| [profile-other](#profile-other) | 3.8% | 3.8% | 6.8% | 6.8% |  |
| [channel-settings-connect](#channel-settings-connect) | 1.2% | 1.2% | 6.6% | 6.6% |  |
| [select-organization](#select-organization) | 2.9% | 2.9% | 6.5% | 6.5% |  |
| [profile](#profile) | 4.0% | 4.0% | 5.5% | 5.5% |  |
| [home-search](#home-search) | 2.9% | 2.9% | 5.5% | 5.5% |  |
| [customers-settings-plans](#customers-settings-plans) | 5.0% | 5.2% | 0.6% | 1.2% |  |
| [root](#root) | 5.1% | 5.2% | 0.0% | 0.0% |  |
| [customers-settings-feature-flags](#customers-settings-feature-flags) | 5.0% | 4.9% | 3.7% | 3.6% |  |
| [palette-query](#palette-query) | 4.7% | 4.5% | 0.4% | 0.5% |  |
| [notifications-unreads](#notifications-unreads) | 2.0% | 2.0% | 4.7% | 4.7% |  |
| [message-menu](#message-menu) | 0.7% | 0.7% | 4.2% | 4.2% |  |
| [more](#more) | 1.2% | 1.2% | 4.0% | 4.0% |  |
| [palette](#palette) | 3.0% | 2.9% | 3.8% | 3.9% |  |
| [settings-invitations](#settings-invitations) | 0.9% | 0.9% | 3.5% | 3.5% |  |
| [message-toolbar](#message-toolbar) | 0.5% | 0.5% | 3.3% | 3.4% |  |
| [bot-install-invalid](#bot-install-invalid) | 0.8% | 0.8% | 3.3% | 3.2% |  |
| [chat-rich](#chat-rich) | 0.1% | 0.1% | 3.1% | 3.2% |  |
| [auth-continue-error](#auth-continue-error) | 0.9% | 0.9% | 3.1% | 3.1% |  |
| [auth-register-broken](#auth-register-broken) | 0.7% | 0.7% | 3.1% | 3.0% |  |
| [oauth-authorize-invalid](#oauth-authorize-invalid) | 0.8% | 0.8% | 3.0% | 3.0% |  |
| [auth-desktop-error](#auth-desktop-error) | 0.8% | 0.8% | 3.0% | 2.9% |  |
| [chat-index-dms](#chat-index-dms) | 2.9% | 2.9% | 0.1% | 0.1% | not mounted at 390 |
| [chat-index-private](#chat-index-private) | 2.8% | 2.7% | 0.1% | 0.1% | not mounted at 390 |
| [channel-header](#channel-header) | 0.5% | 0.5% | 2.6% | 2.6% |  |
| [auth-continue](#auth-continue) | 0.7% | 0.7% | 2.5% | 2.5% |  |
| [customers-list](#customers-list) | 1.6% | 1.6% | 2.4% | 2.4% |  |
| [chat-dms](#chat-dms) | 2.4% | 2.4% | 0.0% | 0.0% |  |
| [auth-desktop](#auth-desktop) | 0.5% | 0.5% | 2.1% | 2.1% |  |
| [my-settings-desktop](#my-settings-desktop) | 0.2% | 0.2% | 0.7% | 0.7% |  |
| [layout-activity](#layout-activity) | 0.0% | 0.0% | 0.0% | 0.0% |  |
| [layout-my-settings](#layout-my-settings) | 0.0% | 0.0% | 0.0% | 0.0% |  |
| [channel-sidebar](#channel-sidebar) | – | – | – | – | no baseline |
| [notifications-all](#notifications-all) | 0.0% | 0.0% | 0.0% | 0.0% |  |
| [dms](#dms) | – | – | – | – | no baseline |
| [modal-change-role](#modal-change-role) | – | – | – | – | step failed: no 'Change role for' button |
| [activity](#activity) | – | – | – | – | no baseline |
| [channel](#channel) | – | – | – | – | no baseline |
| [layout-chat](#layout-chat) | 0.0% | 0.0% | 0.0% | 0.0% | not mounted at 390 |
| [notifications](#notifications) | 0.0% | 0.0% | 0.0% | 0.0% |  |

## channel-header-customer

**light-1180** (13.8%)  
![channel-header-customer light-1180](channel-header-customer/light-1180.jpg)

**dark-1180** (16.9%)  
![channel-header-customer dark-1180](channel-header-customer/dark-1180.jpg)

**light-390** (51.6%)  
![channel-header-customer light-390](channel-header-customer/light-390.jpg)

**dark-390** (50.8%)  
![channel-header-customer dark-390](channel-header-customer/dark-390.jpg)

## customers-signals-picker

**light-1180** (51.1%)  
![customers-signals-picker light-1180](customers-signals-picker/light-1180.jpg)

**dark-1180** (46.1%)  
![customers-signals-picker dark-1180](customers-signals-picker/dark-1180.jpg)

**light-390** (14.8%)  
![customers-signals-picker light-390](customers-signals-picker/light-390.jpg)

**dark-390** (14.8%)  
![customers-signals-picker dark-390](customers-signals-picker/dark-390.jpg)

## customers-attention-mark-done

**light-1180** (21.8%)  
![customers-attention-mark-done light-1180](customers-attention-mark-done/light-1180.jpg)

**dark-1180** (19.7%)  
![customers-attention-mark-done dark-1180](customers-attention-mark-done/dark-1180.jpg)

**light-390** (50.4%)  
![customers-attention-mark-done light-390](customers-attention-mark-done/light-390.jpg)

**dark-390** (50.0%)  
![customers-attention-mark-done dark-390](customers-attention-mark-done/dark-390.jpg)

## customers-list-filter

**light-1180** (10.4%)  
![customers-list-filter light-1180](customers-list-filter/light-1180.jpg)

**dark-1180** (38.2%)  
![customers-list-filter dark-1180](customers-list-filter/dark-1180.jpg)

**light-390** (13.7%)  
![customers-list-filter light-390](customers-list-filter/light-390.jpg)

**dark-390** (49.3%)  
![customers-list-filter dark-390](customers-list-filter/dark-390.jpg)

## modal-edit-bot-error

**light-1180** (15.7%)  
![modal-edit-bot-error light-1180](modal-edit-bot-error/light-1180.jpg)

**dark-1180** (15.8%)  
![modal-edit-bot-error dark-1180](modal-edit-bot-error/dark-1180.jpg)

**light-390** (49.2%)  
![modal-edit-bot-error light-390](modal-edit-bot-error/light-390.jpg)

**dark-390** (49.2%)  
![modal-edit-bot-error dark-390](modal-edit-bot-error/dark-390.jpg)

## modal-edit-bot

**light-1180** (14.5%)  
![modal-edit-bot light-1180](modal-edit-bot/light-1180.jpg)

**dark-1180** (14.5%)  
![modal-edit-bot dark-1180](modal-edit-bot/dark-1180.jpg)

**light-390** (46.6%)  
![modal-edit-bot light-390](modal-edit-bot/light-390.jpg)

**dark-390** (46.6%)  
![modal-edit-bot dark-390](modal-edit-bot/dark-390.jpg)

## customers-list-columns

**light-1180** (8.1%)  
![customers-list-columns light-1180](customers-list-columns/light-1180.jpg)

**dark-1180** (21.9%)  
![customers-list-columns dark-1180](customers-list-columns/dark-1180.jpg)

**light-390** (18.8%)  
![customers-list-columns light-390](customers-list-columns/light-390.jpg)

**dark-390** (45.5%)  
![customers-list-columns dark-390](customers-list-columns/dark-390.jpg)

## customers-signal-rule

**light-1180** (30.6%)  
![customers-signal-rule light-1180](customers-signal-rule/light-1180.jpg)

**dark-1180** (30.6%)  
![customers-signal-rule dark-1180](customers-signal-rule/dark-1180.jpg)

**light-390** (37.3%)  
![customers-signal-rule light-390](customers-signal-rule/light-390.jpg)

**dark-390** (41.1%)  
![customers-signal-rule dark-390](customers-signal-rule/dark-390.jpg)

## modal-create-bot-error

**light-1180** (15.6%)  
![modal-create-bot-error light-1180](modal-create-bot-error/light-1180.jpg)

**dark-1180** (15.6%)  
![modal-create-bot-error dark-1180](modal-create-bot-error/dark-1180.jpg)

**light-390** (39.1%)  
![modal-create-bot-error light-390](modal-create-bot-error/light-390.jpg)

**dark-390** (39.1%)  
![modal-create-bot-error dark-390](modal-create-bot-error/dark-390.jpg)

## customers-sources-connect

**light-1180** (34.2%)  
![customers-sources-connect light-1180](customers-sources-connect/light-1180.jpg)

**dark-1180** (34.3%)  
![customers-sources-connect dark-1180](customers-sources-connect/dark-1180.jpg)

**light-390** (27.6%)  
![customers-sources-connect light-390](customers-sources-connect/light-390.jpg)

**dark-390** (35.7%)  
![customers-sources-connect dark-390](customers-sources-connect/dark-390.jpg)

## modal-create-bot

**light-1180** (14.1%)  
![modal-create-bot light-1180](modal-create-bot/light-1180.jpg)

**dark-1180** (14.1%)  
![modal-create-bot dark-1180](modal-create-bot/dark-1180.jpg)

**light-390** (35.3%)  
![modal-create-bot light-390](modal-create-bot/light-390.jpg)

**dark-390** (35.3%)  
![modal-create-bot dark-390](modal-create-bot/dark-390.jpg)

## modal-create-organization-error

**light-1180** (15.3%)  
![modal-create-organization-error light-1180](modal-create-organization-error/light-1180.jpg)

**dark-1180** (12.8%)  
![modal-create-organization-error dark-1180](modal-create-organization-error/dark-1180.jpg)

**light-390** (35.1%)  
![modal-create-organization-error light-390](modal-create-organization-error/light-390.jpg)

**dark-390** (34.8%)  
![modal-create-organization-error dark-390](modal-create-organization-error/dark-390.jpg)

## chat-files-media

**light-1180** (34.4%)  
![chat-files-media light-1180](chat-files-media/light-1180.jpg)

**dark-1180** (34.4%)  
![chat-files-media dark-1180](chat-files-media/dark-1180.jpg)

**light-390** (0.4%)  
![chat-files-media light-390](chat-files-media/light-390.jpg)

**dark-390** (0.4%)  
![chat-files-media dark-390](chat-files-media/dark-390.jpg)

## assistant

**light-1180** (5.9%)  
![assistant light-1180](assistant/light-1180.jpg)

**dark-1180** (9.0%)  
![assistant dark-1180](assistant/dark-1180.jpg)

**light-390** (20.2%)  
![assistant light-390](assistant/light-390.jpg)

**dark-390** (31.6%)  
![assistant dark-390](assistant/dark-390.jpg)

## modal-request-integration-error

**light-1180** (17.1%)  
![modal-request-integration-error light-1180](modal-request-integration-error/light-1180.jpg)

**dark-1180** (14.9%)  
![modal-request-integration-error dark-1180](modal-request-integration-error/dark-1180.jpg)

**light-390** (31.2%)  
![modal-request-integration-error light-390](modal-request-integration-error/light-390.jpg)

**dark-390** (30.8%)  
![modal-request-integration-error dark-390](modal-request-integration-error/dark-390.jpg)

## customers-settings-feature-flags-open

**light-1180** (31.0%)  
![customers-settings-feature-flags-open light-1180](customers-settings-feature-flags-open/light-1180.jpg)

**dark-1180** (31.0%)  
![customers-settings-feature-flags-open dark-1180](customers-settings-feature-flags-open/dark-1180.jpg)

**light-390** (18.6%)  
![customers-settings-feature-flags-open light-390](customers-settings-feature-flags-open/light-390.jpg)

**dark-390** (18.6%)  
![customers-settings-feature-flags-open dark-390](customers-settings-feature-flags-open/dark-390.jpg)

## modal-create-organization

**light-1180** (12.5%)  
![modal-create-organization light-1180](modal-create-organization/light-1180.jpg)

**dark-1180** (10.3%)  
![modal-create-organization dark-1180](modal-create-organization/dark-1180.jpg)

**light-390** (29.4%)  
![modal-create-organization light-390](modal-create-organization/light-390.jpg)

**dark-390** (29.2%)  
![modal-create-organization dark-390](modal-create-organization/dark-390.jpg)

## chat-migration

**light-1180** (17.3%)  
![chat-migration light-1180](chat-migration/light-1180.jpg)

**dark-1180** (12.3%)  
![chat-migration dark-1180](chat-migration/dark-1180.jpg)

**light-390** (28.4%)  
![chat-migration light-390](chat-migration/light-390.jpg)

**dark-390** (28.1%)  
![chat-migration dark-390](chat-migration/dark-390.jpg)

## channel-settings-connect-share

**light-1180** (14.0%)  
![channel-settings-connect-share light-1180](channel-settings-connect-share/light-1180.jpg)

**dark-1180** (9.5%)  
![channel-settings-connect-share dark-1180](channel-settings-connect-share/dark-1180.jpg)

**light-390** (28.1%)  
![channel-settings-connect-share light-390](channel-settings-connect-share/light-390.jpg)

**dark-390** (27.8%)  
![channel-settings-connect-share dark-390](channel-settings-connect-share/dark-390.jpg)

## modal-set-status

**light-1180** (16.2%)  
![modal-set-status light-1180](modal-set-status/light-1180.jpg)

**dark-1180** (13.8%)  
![modal-set-status dark-1180](modal-set-status/dark-1180.jpg)

**light-390** (27.8%)  
![modal-set-status light-390](modal-set-status/light-390.jpg)

**dark-390** (27.9%)  
![modal-set-status dark-390](modal-set-status/dark-390.jpg)

## customers-attention

**light-1180** (17.3%)  
![customers-attention light-1180](customers-attention/light-1180.jpg)

**dark-1180** (17.1%)  
![customers-attention dark-1180](customers-attention/dark-1180.jpg)

**light-390** (27.8%)  
![customers-attention light-390](customers-attention/light-390.jpg)

**dark-390** (26.9%)  
![customers-attention dark-390](customers-attention/dark-390.jpg)

## customers-settings-sla-editor

**light-1180** (19.3%)  
![customers-settings-sla-editor light-1180](customers-settings-sla-editor/light-1180.jpg)

**dark-1180** (19.3%)  
![customers-settings-sla-editor dark-1180](customers-settings-sla-editor/dark-1180.jpg)

**light-390** (27.6%)  
![customers-settings-sla-editor light-390](customers-settings-sla-editor/light-390.jpg)

**dark-390** (27.0%)  
![customers-settings-sla-editor dark-390](customers-settings-sla-editor/dark-390.jpg)

## settings-integrations

**light-1180** (22.2%)  
![settings-integrations light-1180](settings-integrations/light-1180.jpg)

**dark-1180** (12.1%)  
![settings-integrations dark-1180](settings-integrations/dark-1180.jpg)

**light-390** (27.5%)  
![settings-integrations light-390](settings-integrations/light-390.jpg)

**dark-390** (16.6%)  
![settings-integrations dark-390](settings-integrations/dark-390.jpg)

## modal-create-channel-error

**light-1180** (13.4%)  
![modal-create-channel-error light-1180](modal-create-channel-error/light-1180.jpg)

**dark-1180** (10.9%)  
![modal-create-channel-error dark-1180](modal-create-channel-error/dark-1180.jpg)

**light-390** (26.2%)  
![modal-create-channel-error light-390](modal-create-channel-error/light-390.jpg)

**dark-390** (25.8%)  
![modal-create-channel-error dark-390](modal-create-channel-error/dark-390.jpg)

## settings-general

**light-1180** (15.2%)  
![settings-general light-1180](settings-general/light-1180.jpg)

**dark-1180** (13.0%)  
![settings-general dark-1180](settings-general/dark-1180.jpg)

**light-390** (25.8%)  
![settings-general light-390](settings-general/light-390.jpg)

**dark-390** (22.3%)  
![settings-general dark-390](settings-general/dark-390.jpg)

## layout-settings

**light-1180** (15.3%)  
![layout-settings light-1180](layout-settings/light-1180.jpg)

**dark-1180** (13.0%)  
![layout-settings dark-1180](layout-settings/dark-1180.jpg)

**light-390** (25.8%)  
![layout-settings light-390](layout-settings/light-390.jpg)

**dark-390** (22.3%)  
![layout-settings dark-390](layout-settings/dark-390.jpg)

## my-settings-notifications

**light-1180** (16.5%)  
![my-settings-notifications light-1180](my-settings-notifications/light-1180.jpg)

**dark-1180** (16.6%)  
![my-settings-notifications dark-1180](my-settings-notifications/dark-1180.jpg)

**light-390** (25.5%)  
![my-settings-notifications light-390](my-settings-notifications/light-390.jpg)

**dark-390** (25.6%)  
![my-settings-notifications dark-390](my-settings-notifications/dark-390.jpg)

## customer-detail

**light-1180** (25.1%)  
![customer-detail light-1180](customer-detail/light-1180.jpg)

**dark-1180** (25.0%)  
![customer-detail dark-1180](customer-detail/dark-1180.jpg)

**light-390** (19.5%)  
![customer-detail light-390](customer-detail/light-390.jpg)

**dark-390** (19.4%)  
![customer-detail dark-390](customer-detail/dark-390.jpg)

## modal-request-integration

**light-1180** (15.5%)  
![modal-request-integration light-1180](modal-request-integration/light-1180.jpg)

**dark-1180** (13.3%)  
![modal-request-integration dark-1180](modal-request-integration/dark-1180.jpg)

**light-390** (25.0%)  
![modal-request-integration light-390](modal-request-integration/light-390.jpg)

**dark-390** (25.0%)  
![modal-request-integration dark-390](modal-request-integration/dark-390.jpg)

## modal-keyboard-shortcuts

**light-1180** (24.5%)  
![modal-keyboard-shortcuts light-1180](modal-keyboard-shortcuts/light-1180.jpg)

**dark-1180** (20.1%)  
![modal-keyboard-shortcuts dark-1180](modal-keyboard-shortcuts/dark-1180.jpg)

**light-390** (12.4%)  
![modal-keyboard-shortcuts light-390](modal-keyboard-shortcuts/light-390.jpg)

**dark-390** (14.5%)  
![modal-keyboard-shortcuts dark-390](modal-keyboard-shortcuts/dark-390.jpg)

## auth-register

**light-1180** (3.7%)  
![auth-register light-1180](auth-register/light-1180.jpg)

**dark-1180** (3.7%)  
![auth-register dark-1180](auth-register/dark-1180.jpg)

**light-390** (23.6%)  
![auth-register light-390](auth-register/light-390.jpg)

**dark-390** (23.5%)  
![auth-register dark-390](auth-register/dark-390.jpg)

## palette-search

**light-1180** (16.0%)  
![palette-search light-1180](palette-search/light-1180.jpg)

**dark-1180** (13.4%)  
![palette-search dark-1180](palette-search/dark-1180.jpg)

**light-390** (22.9%)  
![palette-search light-390](palette-search/light-390.jpg)

**dark-390** (22.1%)  
![palette-search dark-390](palette-search/dark-390.jpg)

## modal-install-bot

**light-1180** (13.2%)  
![modal-install-bot light-1180](modal-install-bot/light-1180.jpg)

**dark-1180** (8.4%)  
![modal-install-bot dark-1180](modal-install-bot/dark-1180.jpg)

**light-390** (21.9%)  
![modal-install-bot light-390](modal-install-bot/light-390.jpg)

**dark-390** (21.8%)  
![modal-install-bot dark-390](modal-install-bot/dark-390.jpg)

## settings-integrations-your-apps-menu

**light-1180** (3.0%)  
![settings-integrations-your-apps-menu light-1180](settings-integrations-your-apps-menu/light-1180.jpg)

**dark-1180** (4.2%)  
![settings-integrations-your-apps-menu dark-1180](settings-integrations-your-apps-menu/dark-1180.jpg)

**light-390** (17.9%)  
![settings-integrations-your-apps-menu light-390](settings-integrations-your-apps-menu/light-390.jpg)

**dark-390** (21.9%)  
![settings-integrations-your-apps-menu dark-390](settings-integrations-your-apps-menu/dark-390.jpg)

## auth-register-invalid

**light-1180** (5.3%)  
![auth-register-invalid light-1180](auth-register-invalid/light-1180.jpg)

**dark-1180** (5.3%)  
![auth-register-invalid dark-1180](auth-register-invalid/dark-1180.jpg)

**light-390** (21.7%)  
![auth-register-invalid light-390](auth-register-invalid/light-390.jpg)

**dark-390** (21.6%)  
![auth-register-invalid dark-390](auth-register-invalid/dark-390.jpg)

## settings-chat-sync

**light-1180** (21.6%)  
![settings-chat-sync light-1180](settings-chat-sync/light-1180.jpg)

**dark-1180** (21.4%)  
![settings-chat-sync dark-1180](settings-chat-sync/dark-1180.jpg)

**light-390** (16.6%)  
![settings-chat-sync light-390](settings-chat-sync/light-390.jpg)

**dark-390** (17.1%)  
![settings-chat-sync dark-390](settings-chat-sync/dark-390.jpg)

## modal-create-channel

**light-1180** (11.9%)  
![modal-create-channel light-1180](modal-create-channel/light-1180.jpg)

**dark-1180** (9.2%)  
![modal-create-channel dark-1180](modal-create-channel/dark-1180.jpg)

**light-390** (21.5%)  
![modal-create-channel light-390](modal-create-channel/light-390.jpg)

**dark-390** (21.3%)  
![modal-create-channel dark-390](modal-create-channel/dark-390.jpg)

## customers-attention-preview

**light-1180** (20.5%)  
![customers-attention-preview light-1180](customers-attention-preview/light-1180.jpg)

**dark-1180** (19.8%)  
![customers-attention-preview dark-1180](customers-attention-preview/dark-1180.jpg)

**light-390** (15.1%)  
![customers-attention-preview light-390](customers-attention-preview/light-390.jpg)

**dark-390** (18.7%)  
![customers-attention-preview dark-390](customers-attention-preview/dark-390.jpg)

## bot-install

**light-1180** (4.5%)  
![bot-install light-1180](bot-install/light-1180.jpg)

**dark-1180** (4.5%)  
![bot-install dark-1180](bot-install/dark-1180.jpg)

**light-390** (20.4%)  
![bot-install light-390](bot-install/light-390.jpg)

**dark-390** (20.5%)  
![bot-install dark-390](bot-install/dark-390.jpg)

## auth-register-error

**light-1180** (3.3%)  
![auth-register-error light-1180](auth-register-error/light-1180.jpg)

**dark-1180** (3.2%)  
![auth-register-error dark-1180](auth-register-error/dark-1180.jpg)

**light-390** (20.4%)  
![auth-register-error light-390](auth-register-error/light-390.jpg)

**dark-390** (20.4%)  
![auth-register-error dark-390](auth-register-error/dark-390.jpg)

## composer

**light-1180** (8.8%)  
![composer light-1180](composer/light-1180.jpg)

**dark-1180** (19.4%)  
![composer dark-1180](composer/dark-1180.jpg)

**light-390** (0.5%)  
![composer light-390](composer/light-390.jpg)

**dark-390** (0.5%)  
![composer dark-390](composer/dark-390.jpg)

## my-settings-appearance

**light-1180** (17.7%)  
![my-settings-appearance light-1180](my-settings-appearance/light-1180.jpg)

**dark-1180** (18.8%)  
![my-settings-appearance dark-1180](my-settings-appearance/dark-1180.jpg)

**light-390** (13.5%)  
![my-settings-appearance light-390](my-settings-appearance/light-390.jpg)

**dark-390** (13.5%)  
![my-settings-appearance dark-390](my-settings-appearance/dark-390.jpg)

## customers-signals

**light-1180** (13.2%)  
![customers-signals light-1180](customers-signals/light-1180.jpg)

**dark-1180** (13.0%)  
![customers-signals dark-1180](customers-signals/dark-1180.jpg)

**light-390** (18.2%)  
![customers-signals light-390](customers-signals/light-390.jpg)

**dark-390** (18.4%)  
![customers-signals dark-390](customers-signals/dark-390.jpg)

## customers-attention-done

**light-1180** (16.2%)  
![customers-attention-done light-1180](customers-attention-done/light-1180.jpg)

**dark-1180** (16.2%)  
![customers-attention-done dark-1180](customers-attention-done/dark-1180.jpg)

**light-390** (18.4%)  
![customers-attention-done light-390](customers-attention-done/light-390.jpg)

**dark-390** (16.4%)  
![customers-attention-done dark-390](customers-attention-done/dark-390.jpg)

## modal-email-invite

**light-1180** (15.1%)  
![modal-email-invite light-1180](modal-email-invite/light-1180.jpg)

**dark-1180** (12.8%)  
![modal-email-invite dark-1180](modal-email-invite/dark-1180.jpg)

**light-390** (17.6%)  
![modal-email-invite light-390](modal-email-invite/light-390.jpg)

**dark-390** (17.4%)  
![modal-email-invite dark-390](modal-email-invite/dark-390.jpg)

## emoji-picker

**light-1180** (7.4%)  
![emoji-picker light-1180](emoji-picker/light-1180.jpg)

**dark-1180** (17.5%)  
![emoji-picker dark-1180](emoji-picker/dark-1180.jpg)

**light-390** (2.6%)  
![emoji-picker light-390](emoji-picker/light-390.jpg)

**dark-390** (2.6%)  
![emoji-picker dark-390](emoji-picker/dark-390.jpg)

## palette-filter

**light-1180** (13.2%)  
![palette-filter light-1180](palette-filter/light-1180.jpg)

**dark-1180** (10.7%)  
![palette-filter dark-1180](palette-filter/dark-1180.jpg)

**light-390** (17.4%)  
![palette-filter light-390](palette-filter/light-390.jpg)

**dark-390** (16.6%)  
![palette-filter dark-390](palette-filter/dark-390.jpg)

## customers-sources

**light-1180** (10.9%)  
![customers-sources light-1180](customers-sources/light-1180.jpg)

**dark-1180** (10.9%)  
![customers-sources dark-1180](customers-sources/dark-1180.jpg)

**light-390** (16.7%)  
![customers-sources light-390](customers-sources/light-390.jpg)

**dark-390** (16.7%)  
![customers-sources dark-390](customers-sources/dark-390.jpg)

## customers-attention-snoozed

**light-1180** (15.0%)  
![customers-attention-snoozed light-1180](customers-attention-snoozed/light-1180.jpg)

**dark-1180** (14.9%)  
![customers-attention-snoozed dark-1180](customers-attention-snoozed/dark-1180.jpg)

**light-390** (16.3%)  
![customers-attention-snoozed light-390](customers-attention-snoozed/light-390.jpg)

**dark-390** (15.4%)  
![customers-attention-snoozed dark-390](customers-attention-snoozed/dark-390.jpg)

## oauth-authorize

**light-1180** (5.3%)  
![oauth-authorize light-1180](oauth-authorize/light-1180.jpg)

**dark-1180** (5.3%)  
![oauth-authorize dark-1180](oauth-authorize/dark-1180.jpg)

**light-390** (15.8%)  
![oauth-authorize light-390](oauth-authorize/light-390.jpg)

**dark-390** (15.8%)  
![oauth-authorize dark-390](oauth-authorize/dark-390.jpg)

## modal-regenerate-bot-token

**light-1180** (0.1%)  
![modal-regenerate-bot-token light-1180](modal-regenerate-bot-token/light-1180.jpg)

**dark-1180** (0.1%)  
![modal-regenerate-bot-token dark-1180](modal-regenerate-bot-token/dark-1180.jpg)

**light-390** (15.6%)  
![modal-regenerate-bot-token light-390](modal-regenerate-bot-token/light-390.jpg)

**dark-390** (15.6%)  
![modal-regenerate-bot-token dark-390](modal-regenerate-bot-token/dark-390.jpg)

## modal-feedback-error

**light-1180** (11.0%)  
![modal-feedback-error light-1180](modal-feedback-error/light-1180.jpg)

**dark-1180** (8.4%)  
![modal-feedback-error dark-1180](modal-feedback-error/dark-1180.jpg)

**light-390** (15.6%)  
![modal-feedback-error light-390](modal-feedback-error/light-390.jpg)

**dark-390** (15.3%)  
![modal-feedback-error dark-390](modal-feedback-error/dark-390.jpg)

## settings-custom-emojis

**light-1180** (6.5%)  
![settings-custom-emojis light-1180](settings-custom-emojis/light-1180.jpg)

**dark-1180** (9.3%)  
![settings-custom-emojis dark-1180](settings-custom-emojis/dark-1180.jpg)

**light-390** (9.7%)  
![settings-custom-emojis light-390](settings-custom-emojis/light-390.jpg)

**dark-390** (15.2%)  
![settings-custom-emojis dark-390](settings-custom-emojis/dark-390.jpg)

## settings-integrations-installed-confirm

**light-1180** (10.2%)  
![settings-integrations-installed-confirm light-1180](settings-integrations-installed-confirm/light-1180.jpg)

**dark-1180** (9.9%)  
![settings-integrations-installed-confirm dark-1180](settings-integrations-installed-confirm/dark-1180.jpg)

**light-390** (14.9%)  
![settings-integrations-installed-confirm light-390](settings-integrations-installed-confirm/light-390.jpg)

**dark-390** (14.9%)  
![settings-integrations-installed-confirm dark-390](settings-integrations-installed-confirm/dark-390.jpg)

## settings-integrations-your-apps

**light-1180** (7.9%)  
![settings-integrations-your-apps light-1180](settings-integrations-your-apps/light-1180.jpg)

**dark-1180** (7.8%)  
![settings-integrations-your-apps dark-1180](settings-integrations-your-apps/dark-1180.jpg)

**light-390** (14.4%)  
![settings-integrations-your-apps light-390](settings-integrations-your-apps/light-390.jpg)

**dark-390** (14.5%)  
![settings-integrations-your-apps dark-390](settings-integrations-your-apps/dark-390.jpg)

## modal-create-dm

**light-1180** (9.8%)  
![modal-create-dm light-1180](modal-create-dm/light-1180.jpg)

**dark-1180** (7.4%)  
![modal-create-dm dark-1180](modal-create-dm/dark-1180.jpg)

**light-390** (14.3%)  
![modal-create-dm light-390](modal-create-dm/light-390.jpg)

**dark-390** (14.5%)  
![modal-create-dm dark-390](modal-create-dm/dark-390.jpg)

## join

**light-1180** (2.9%)  
![join light-1180](join/light-1180.jpg)

**dark-1180** (2.6%)  
![join dark-1180](join/dark-1180.jpg)

**light-390** (14.2%)  
![join light-390](join/light-390.jpg)

**dark-390** (13.5%)  
![join dark-390](join/dark-390.jpg)

## modal-delete-bot

**light-1180** (6.9%)  
![modal-delete-bot light-1180](modal-delete-bot/light-1180.jpg)

**dark-1180** (3.5%)  
![modal-delete-bot dark-1180](modal-delete-bot/dark-1180.jpg)

**light-390** (14.2%)  
![modal-delete-bot light-390](modal-delete-bot/light-390.jpg)

**dark-390** (14.1%)  
![modal-delete-bot dark-390](modal-delete-bot/dark-390.jpg)

## select-organization-empty

**light-1180** (8.2%)  
![select-organization-empty light-1180](select-organization-empty/light-1180.jpg)

**dark-1180** (8.2%)  
![select-organization-empty dark-1180](select-organization-empty/dark-1180.jpg)

**light-390** (13.8%)  
![select-organization-empty light-390](select-organization-empty/light-390.jpg)

**dark-390** (13.7%)  
![select-organization-empty dark-390](select-organization-empty/dark-390.jpg)

## customers-overview

**light-1180** (13.5%)  
![customers-overview light-1180](customers-overview/light-1180.jpg)

**dark-1180** (13.4%)  
![customers-overview dark-1180](customers-overview/dark-1180.jpg)

**light-390** (6.5%)  
![customers-overview light-390](customers-overview/light-390.jpg)

**dark-390** (6.6%)  
![customers-overview dark-390](customers-overview/dark-390.jpg)

## settings-integrations-installed

**light-1180** (8.1%)  
![settings-integrations-installed light-1180](settings-integrations-installed/light-1180.jpg)

**dark-1180** (7.9%)  
![settings-integrations-installed dark-1180](settings-integrations-installed/dark-1180.jpg)

**light-390** (12.8%)  
![settings-integrations-installed light-390](settings-integrations-installed/light-390.jpg)

**dark-390** (12.9%)  
![settings-integrations-installed dark-390](settings-integrations-installed/dark-390.jpg)

## onboarding-profile

**light-1180** (7.9%)  
![onboarding-profile light-1180](onboarding-profile/light-1180.jpg)

**dark-1180** (7.9%)  
![onboarding-profile dark-1180](onboarding-profile/dark-1180.jpg)

**light-390** (12.4%)  
![onboarding-profile light-390](onboarding-profile/light-390.jpg)

**dark-390** (12.4%)  
![onboarding-profile dark-390](onboarding-profile/dark-390.jpg)

## settings-groups

**light-1180** (6.2%)  
![settings-groups light-1180](settings-groups/light-1180.jpg)

**dark-1180** (6.1%)  
![settings-groups dark-1180](settings-groups/dark-1180.jpg)

**light-390** (12.2%)  
![settings-groups light-390](settings-groups/light-390.jpg)

**dark-390** (12.2%)  
![settings-groups dark-390](settings-groups/dark-390.jpg)

## chat-files

**light-1180** (11.9%)  
![chat-files light-1180](chat-files/light-1180.jpg)

**dark-1180** (11.9%)  
![chat-files dark-1180](chat-files/dark-1180.jpg)

**light-390** (3.1%)  
![chat-files light-390](chat-files/light-390.jpg)

**dark-390** (3.1%)  
![chat-files dark-390](chat-files/dark-390.jpg)

## home

**light-1180** (5.1%)  
![home light-1180](home/light-1180.jpg)

**dark-1180** (5.2%)  
![home dark-1180](home/dark-1180.jpg)

**light-390** (11.6%)  
![home light-390](home/light-390.jpg)

**dark-390** (11.9%)  
![home dark-390](home/dark-390.jpg)

## modal-feedback

**light-1180** (10.1%)  
![modal-feedback light-1180](modal-feedback/light-1180.jpg)

**dark-1180** (7.5%)  
![modal-feedback dark-1180](modal-feedback/dark-1180.jpg)

**light-390** (11.7%)  
![modal-feedback light-390](modal-feedback/light-390.jpg)

**dark-390** (11.8%)  
![modal-feedback dark-390](modal-feedback/dark-390.jpg)

## customers-settings-sla

**light-1180** (11.3%)  
![customers-settings-sla light-1180](customers-settings-sla/light-1180.jpg)

**dark-1180** (11.3%)  
![customers-settings-sla dark-1180](customers-settings-sla/dark-1180.jpg)

**light-390** (11.8%)  
![customers-settings-sla light-390](customers-settings-sla/light-390.jpg)

**dark-390** (11.7%)  
![customers-settings-sla dark-390](customers-settings-sla/dark-390.jpg)

## settings-integrations-marketplace

**light-1180** (11.4%)  
![settings-integrations-marketplace light-1180](settings-integrations-marketplace/light-1180.jpg)

**dark-1180** (11.3%)  
![settings-integrations-marketplace dark-1180](settings-integrations-marketplace/dark-1180.jpg)

**light-390** (5.4%)  
![settings-integrations-marketplace light-390](settings-integrations-marketplace/light-390.jpg)

**dark-390** (5.3%)  
![settings-integrations-marketplace dark-390](settings-integrations-marketplace/dark-390.jpg)

## message-profile

**light-1180** (0.3%)  
![message-profile light-1180](message-profile/light-1180.jpg)

**dark-1180** (0.3%)  
![message-profile dark-1180](message-profile/dark-1180.jpg)

**light-390** (11.3%)  
![message-profile light-390](message-profile/light-390.jpg)

**dark-390** (11.3%)  
![message-profile dark-390](message-profile/dark-390.jpg)

## sign-in-error

**light-1180** (1.6%)  
![sign-in-error light-1180](sign-in-error/light-1180.jpg)

**dark-1180** (1.6%)  
![sign-in-error dark-1180](sign-in-error/dark-1180.jpg)

**light-390** (11.1%)  
![sign-in-error light-390](sign-in-error/light-390.jpg)

**dark-390** (11.3%)  
![sign-in-error dark-390](sign-in-error/dark-390.jpg)

## message-reactions

**light-1180** (4.2%)  
![message-reactions light-1180](message-reactions/light-1180.jpg)

**dark-1180** (4.4%)  
![message-reactions dark-1180](message-reactions/dark-1180.jpg)

**light-390** (11.1%)  
![message-reactions light-390](message-reactions/light-390.jpg)

**dark-390** (11.2%)  
![message-reactions dark-390](message-reactions/dark-390.jpg)

## settings-team

**light-1180** (2.1%)  
![settings-team light-1180](settings-team/light-1180.jpg)

**dark-1180** (2.2%)  
![settings-team dark-1180](settings-team/dark-1180.jpg)

**light-390** (10.5%)  
![settings-team light-390](settings-team/light-390.jpg)

**dark-390** (10.5%)  
![settings-team dark-390](settings-team/dark-390.jpg)

## layout-channel-settings

**light-1180** (3.0%)  
![layout-channel-settings light-1180](layout-channel-settings/light-1180.jpg)

**dark-1180** (3.0%)  
![layout-channel-settings dark-1180](layout-channel-settings/dark-1180.jpg)

**light-390** (10.1%)  
![layout-channel-settings light-390](layout-channel-settings/light-390.jpg)

**dark-390** (10.0%)  
![layout-channel-settings dark-390](layout-channel-settings/dark-390.jpg)

## channel-settings-connect-shared

**light-1180** (2.0%)  
![channel-settings-connect-shared light-1180](channel-settings-connect-shared/light-1180.jpg)

**dark-1180** (1.8%)  
![channel-settings-connect-shared dark-1180](channel-settings-connect-shared/dark-1180.jpg)

**light-390** (10.0%)  
![channel-settings-connect-shared light-390](channel-settings-connect-shared/light-390.jpg)

**dark-390** (10.0%)  
![channel-settings-connect-shared dark-390](channel-settings-connect-shared/dark-390.jpg)

## palette-recents

**light-1180** (3.9%)  
![palette-recents light-1180](palette-recents/light-1180.jpg)

**dark-1180** (3.1%)  
![palette-recents dark-1180](palette-recents/dark-1180.jpg)

**light-390** (9.7%)  
![palette-recents light-390](palette-recents/light-390.jpg)

**dark-390** (9.9%)  
![palette-recents dark-390](palette-recents/dark-390.jpg)

## channel-header-bell

**light-1180** (2.0%)  
![channel-header-bell light-1180](channel-header-bell/light-1180.jpg)

**dark-1180** (2.7%)  
![channel-header-bell dark-1180](channel-header-bell/dark-1180.jpg)

**light-390** (7.9%)  
![channel-header-bell light-390](channel-header-bell/light-390.jpg)

**dark-390** (9.5%)  
![channel-header-bell dark-390](channel-header-bell/dark-390.jpg)

## channel-header-pins

**light-1180** (3.4%)  
![channel-header-pins light-1180](channel-header-pins/light-1180.jpg)

**dark-1180** (2.8%)  
![channel-header-pins dark-1180](channel-header-pins/dark-1180.jpg)

**light-390** (9.3%)  
![channel-header-pins light-390](channel-header-pins/light-390.jpg)

**dark-390** (8.0%)  
![channel-header-pins dark-390](channel-header-pins/dark-390.jpg)

## modal-create-section-error

**light-1180** (9.2%)  
![modal-create-section-error light-1180](modal-create-section-error/light-1180.jpg)

**dark-1180** (6.8%)  
![modal-create-section-error dark-1180](modal-create-section-error/dark-1180.jpg)

**light-390** (0.1%)  
![modal-create-section-error light-390](modal-create-section-error/light-390.jpg)

**dark-390** (0.1%)  
![modal-create-section-error dark-390](modal-create-section-error/dark-390.jpg)

## sign-in

**light-1180** (1.3%)  
![sign-in light-1180](sign-in/light-1180.jpg)

**dark-1180** (1.3%)  
![sign-in dark-1180](sign-in/dark-1180.jpg)

**light-390** (8.3%)  
![sign-in light-390](sign-in/light-390.jpg)

**dark-390** (8.5%)  
![sign-in dark-390](sign-in/dark-390.jpg)

## sign-up

**light-1180** (1.3%)  
![sign-up light-1180](sign-up/light-1180.jpg)

**dark-1180** (1.3%)  
![sign-up dark-1180](sign-up/dark-1180.jpg)

**light-390** (8.3%)  
![sign-up light-390](sign-up/light-390.jpg)

**dark-390** (8.5%)  
![sign-up dark-390](sign-up/dark-390.jpg)

## modal-join-channel

**light-1180** (7.2%)  
![modal-join-channel light-1180](modal-join-channel/light-1180.jpg)

**dark-1180** (4.8%)  
![modal-join-channel dark-1180](modal-join-channel/dark-1180.jpg)

**light-390** (8.4%)  
![modal-join-channel light-390](modal-join-channel/light-390.jpg)

**dark-390** (8.5%)  
![modal-join-channel dark-390](modal-join-channel/dark-390.jpg)

## layout-customers

**light-1180** (0.1%)  
![layout-customers light-1180](layout-customers/light-1180.jpg)

**dark-1180** (0.1%)  
![layout-customers dark-1180](layout-customers/dark-1180.jpg)

**light-390** (8.1%)  
![layout-customers light-390](layout-customers/light-390.jpg)

**dark-390** (8.0%)  
![layout-customers dark-390](layout-customers/dark-390.jpg)

## channel-settings-overview-customer

**light-1180** (4.6%)  
![channel-settings-overview-customer light-1180](channel-settings-overview-customer/light-1180.jpg)

**dark-1180** (4.6%)  
![channel-settings-overview-customer dark-1180](channel-settings-overview-customer/dark-1180.jpg)

**light-390** (8.1%)  
![channel-settings-overview-customer light-390](channel-settings-overview-customer/light-390.jpg)

**dark-390** (8.0%)  
![channel-settings-overview-customer dark-390](channel-settings-overview-customer/dark-390.jpg)

## modal-create-section

**light-1180** (8.1%)  
![modal-create-section light-1180](modal-create-section/light-1180.jpg)

**dark-1180** (6.0%)  
![modal-create-section dark-1180](modal-create-section/dark-1180.jpg)

**light-390** (0.1%)  
![modal-create-section light-390](modal-create-section/light-390.jpg)

**dark-390** (0.1%)  
![modal-create-section dark-390](modal-create-section/dark-390.jpg)

## channel-settings-overview

**light-1180** (4.5%)  
![channel-settings-overview light-1180](channel-settings-overview/light-1180.jpg)

**dark-1180** (4.5%)  
![channel-settings-overview dark-1180](channel-settings-overview/dark-1180.jpg)

**light-390** (7.9%)  
![channel-settings-overview light-390](channel-settings-overview/light-390.jpg)

**dark-390** (7.8%)  
![channel-settings-overview dark-390](channel-settings-overview/dark-390.jpg)

## settings-connect-invites

**light-1180** (6.2%)  
![settings-connect-invites light-1180](settings-connect-invites/light-1180.jpg)

**dark-1180** (6.2%)  
![settings-connect-invites dark-1180](settings-connect-invites/dark-1180.jpg)

**light-390** (7.6%)  
![settings-connect-invites light-390](settings-connect-invites/light-390.jpg)

**dark-390** (7.6%)  
![settings-connect-invites dark-390](settings-connect-invites/dark-390.jpg)

## chat-index

**light-1180** (7.5%)  
![chat-index light-1180](chat-index/light-1180.jpg)

**dark-1180** (7.5%)  
![chat-index dark-1180](chat-index/dark-1180.jpg)

**light-390** (0.1%)  
![chat-index light-390](chat-index/light-390.jpg)

**dark-390** (0.1%)  
![chat-index dark-390](chat-index/dark-390.jpg)

## customers-support

**light-1180** (6.1%)  
![customers-support light-1180](customers-support/light-1180.jpg)

**dark-1180** (6.1%)  
![customers-support dark-1180](customers-support/dark-1180.jpg)

**light-390** (7.4%)  
![customers-support light-390](customers-support/light-390.jpg)

**dark-390** (7.4%)  
![customers-support dark-390](customers-support/dark-390.jpg)

## onboarding

**light-1180** (4.8%)  
![onboarding light-1180](onboarding/light-1180.jpg)

**dark-1180** (4.8%)  
![onboarding dark-1180](onboarding/dark-1180.jpg)

**light-390** (7.4%)  
![onboarding light-390](onboarding/light-390.jpg)

**dark-390** (7.3%)  
![onboarding dark-390](onboarding/dark-390.jpg)

## join-not-found

**light-1180** (1.7%)  
![join-not-found light-1180](join-not-found/light-1180.jpg)

**dark-1180** (1.7%)  
![join-not-found dark-1180](join-not-found/dark-1180.jpg)

**light-390** (7.0%)  
![join-not-found light-390](join-not-found/light-390.jpg)

**dark-390** (7.0%)  
![join-not-found dark-390](join-not-found/dark-390.jpg)

## profile-other

**light-1180** (3.8%)  
![profile-other light-1180](profile-other/light-1180.jpg)

**dark-1180** (3.8%)  
![profile-other dark-1180](profile-other/dark-1180.jpg)

**light-390** (6.8%)  
![profile-other light-390](profile-other/light-390.jpg)

**dark-390** (6.8%)  
![profile-other dark-390](profile-other/dark-390.jpg)

## channel-settings-connect

**light-1180** (1.2%)  
![channel-settings-connect light-1180](channel-settings-connect/light-1180.jpg)

**dark-1180** (1.2%)  
![channel-settings-connect dark-1180](channel-settings-connect/dark-1180.jpg)

**light-390** (6.6%)  
![channel-settings-connect light-390](channel-settings-connect/light-390.jpg)

**dark-390** (6.6%)  
![channel-settings-connect dark-390](channel-settings-connect/dark-390.jpg)

## select-organization

**light-1180** (2.9%)  
![select-organization light-1180](select-organization/light-1180.jpg)

**dark-1180** (2.9%)  
![select-organization dark-1180](select-organization/dark-1180.jpg)

**light-390** (6.5%)  
![select-organization light-390](select-organization/light-390.jpg)

**dark-390** (6.5%)  
![select-organization dark-390](select-organization/dark-390.jpg)

## profile

**light-1180** (4.0%)  
![profile light-1180](profile/light-1180.jpg)

**dark-1180** (4.0%)  
![profile dark-1180](profile/dark-1180.jpg)

**light-390** (5.5%)  
![profile light-390](profile/light-390.jpg)

**dark-390** (5.5%)  
![profile dark-390](profile/dark-390.jpg)

## home-search

**light-1180** (2.9%)  
![home-search light-1180](home-search/light-1180.jpg)

**dark-1180** (2.9%)  
![home-search dark-1180](home-search/dark-1180.jpg)

**light-390** (5.5%)  
![home-search light-390](home-search/light-390.jpg)

**dark-390** (5.5%)  
![home-search dark-390](home-search/dark-390.jpg)

## customers-settings-plans

**light-1180** (5.0%)  
![customers-settings-plans light-1180](customers-settings-plans/light-1180.jpg)

**dark-1180** (5.2%)  
![customers-settings-plans dark-1180](customers-settings-plans/dark-1180.jpg)

**light-390** (0.6%)  
![customers-settings-plans light-390](customers-settings-plans/light-390.jpg)

**dark-390** (1.2%)  
![customers-settings-plans dark-390](customers-settings-plans/dark-390.jpg)

## root

**light-1180** (5.1%)  
![root light-1180](root/light-1180.jpg)

**dark-1180** (5.2%)  
![root dark-1180](root/dark-1180.jpg)

**light-390** (0.0%)  
![root light-390](root/light-390.jpg)

**dark-390** (0.0%)  
![root dark-390](root/dark-390.jpg)

## customers-settings-feature-flags

**light-1180** (5.0%)  
![customers-settings-feature-flags light-1180](customers-settings-feature-flags/light-1180.jpg)

**dark-1180** (4.9%)  
![customers-settings-feature-flags dark-1180](customers-settings-feature-flags/dark-1180.jpg)

**light-390** (3.7%)  
![customers-settings-feature-flags light-390](customers-settings-feature-flags/light-390.jpg)

**dark-390** (3.6%)  
![customers-settings-feature-flags dark-390](customers-settings-feature-flags/dark-390.jpg)

## palette-query

**light-1180** (4.7%)  
![palette-query light-1180](palette-query/light-1180.jpg)

**dark-1180** (4.5%)  
![palette-query dark-1180](palette-query/dark-1180.jpg)

**light-390** (0.4%)  
![palette-query light-390](palette-query/light-390.jpg)

**dark-390** (0.5%)  
![palette-query dark-390](palette-query/dark-390.jpg)

## notifications-unreads

**light-1180** (2.0%)  
![notifications-unreads light-1180](notifications-unreads/light-1180.jpg)

**dark-1180** (2.0%)  
![notifications-unreads dark-1180](notifications-unreads/dark-1180.jpg)

**light-390** (4.7%)  
![notifications-unreads light-390](notifications-unreads/light-390.jpg)

**dark-390** (4.7%)  
![notifications-unreads dark-390](notifications-unreads/dark-390.jpg)

## message-menu

**light-1180** (0.7%)  
![message-menu light-1180](message-menu/light-1180.jpg)

**dark-1180** (0.7%)  
![message-menu dark-1180](message-menu/dark-1180.jpg)

**light-390** (4.2%)  
![message-menu light-390](message-menu/light-390.jpg)

**dark-390** (4.2%)  
![message-menu dark-390](message-menu/dark-390.jpg)

## more

**light-1180** (1.2%)  
![more light-1180](more/light-1180.jpg)

**dark-1180** (1.2%)  
![more dark-1180](more/dark-1180.jpg)

**light-390** (4.0%)  
![more light-390](more/light-390.jpg)

**dark-390** (4.0%)  
![more dark-390](more/dark-390.jpg)

## palette

**light-1180** (3.0%)  
![palette light-1180](palette/light-1180.jpg)

**dark-1180** (2.9%)  
![palette dark-1180](palette/dark-1180.jpg)

**light-390** (3.8%)  
![palette light-390](palette/light-390.jpg)

**dark-390** (3.9%)  
![palette dark-390](palette/dark-390.jpg)

## settings-invitations

**light-1180** (0.9%)  
![settings-invitations light-1180](settings-invitations/light-1180.jpg)

**dark-1180** (0.9%)  
![settings-invitations dark-1180](settings-invitations/dark-1180.jpg)

**light-390** (3.5%)  
![settings-invitations light-390](settings-invitations/light-390.jpg)

**dark-390** (3.5%)  
![settings-invitations dark-390](settings-invitations/dark-390.jpg)

## message-toolbar

**light-1180** (0.5%)  
![message-toolbar light-1180](message-toolbar/light-1180.jpg)

**dark-1180** (0.5%)  
![message-toolbar dark-1180](message-toolbar/dark-1180.jpg)

**light-390** (3.3%)  
![message-toolbar light-390](message-toolbar/light-390.jpg)

**dark-390** (3.4%)  
![message-toolbar dark-390](message-toolbar/dark-390.jpg)

## bot-install-invalid

**light-1180** (0.8%)  
![bot-install-invalid light-1180](bot-install-invalid/light-1180.jpg)

**dark-1180** (0.8%)  
![bot-install-invalid dark-1180](bot-install-invalid/dark-1180.jpg)

**light-390** (3.3%)  
![bot-install-invalid light-390](bot-install-invalid/light-390.jpg)

**dark-390** (3.2%)  
![bot-install-invalid dark-390](bot-install-invalid/dark-390.jpg)

## chat-rich

**light-1180** (0.1%)  
![chat-rich light-1180](chat-rich/light-1180.jpg)

**dark-1180** (0.1%)  
![chat-rich dark-1180](chat-rich/dark-1180.jpg)

**light-390** (3.1%)  
![chat-rich light-390](chat-rich/light-390.jpg)

**dark-390** (3.2%)  
![chat-rich dark-390](chat-rich/dark-390.jpg)

## auth-continue-error

**light-1180** (0.9%)  
![auth-continue-error light-1180](auth-continue-error/light-1180.jpg)

**dark-1180** (0.9%)  
![auth-continue-error dark-1180](auth-continue-error/dark-1180.jpg)

**light-390** (3.1%)  
![auth-continue-error light-390](auth-continue-error/light-390.jpg)

**dark-390** (3.1%)  
![auth-continue-error dark-390](auth-continue-error/dark-390.jpg)

## auth-register-broken

**light-1180** (0.7%)  
![auth-register-broken light-1180](auth-register-broken/light-1180.jpg)

**dark-1180** (0.7%)  
![auth-register-broken dark-1180](auth-register-broken/dark-1180.jpg)

**light-390** (3.1%)  
![auth-register-broken light-390](auth-register-broken/light-390.jpg)

**dark-390** (3.0%)  
![auth-register-broken dark-390](auth-register-broken/dark-390.jpg)

## oauth-authorize-invalid

**light-1180** (0.8%)  
![oauth-authorize-invalid light-1180](oauth-authorize-invalid/light-1180.jpg)

**dark-1180** (0.8%)  
![oauth-authorize-invalid dark-1180](oauth-authorize-invalid/dark-1180.jpg)

**light-390** (3.0%)  
![oauth-authorize-invalid light-390](oauth-authorize-invalid/light-390.jpg)

**dark-390** (3.0%)  
![oauth-authorize-invalid dark-390](oauth-authorize-invalid/dark-390.jpg)

## auth-desktop-error

**light-1180** (0.8%)  
![auth-desktop-error light-1180](auth-desktop-error/light-1180.jpg)

**dark-1180** (0.8%)  
![auth-desktop-error dark-1180](auth-desktop-error/dark-1180.jpg)

**light-390** (3.0%)  
![auth-desktop-error light-390](auth-desktop-error/light-390.jpg)

**dark-390** (2.9%)  
![auth-desktop-error dark-390](auth-desktop-error/dark-390.jpg)

## chat-index-dms

**light-1180** (2.9%)  
![chat-index-dms light-1180](chat-index-dms/light-1180.jpg)

**dark-1180** (2.9%)  
![chat-index-dms dark-1180](chat-index-dms/dark-1180.jpg)

**light-390** (0.1%)  
![chat-index-dms light-390](chat-index-dms/light-390.jpg)

**dark-390** (0.1%)  
![chat-index-dms dark-390](chat-index-dms/dark-390.jpg)

## chat-index-private

**light-1180** (2.8%)  
![chat-index-private light-1180](chat-index-private/light-1180.jpg)

**dark-1180** (2.7%)  
![chat-index-private dark-1180](chat-index-private/dark-1180.jpg)

**light-390** (0.1%)  
![chat-index-private light-390](chat-index-private/light-390.jpg)

**dark-390** (0.1%)  
![chat-index-private dark-390](chat-index-private/dark-390.jpg)

## channel-header

**light-1180** (0.5%)  
![channel-header light-1180](channel-header/light-1180.jpg)

**dark-1180** (0.5%)  
![channel-header dark-1180](channel-header/dark-1180.jpg)

**light-390** (2.6%)  
![channel-header light-390](channel-header/light-390.jpg)

**dark-390** (2.6%)  
![channel-header dark-390](channel-header/dark-390.jpg)

## auth-continue

**light-1180** (0.7%)  
![auth-continue light-1180](auth-continue/light-1180.jpg)

**dark-1180** (0.7%)  
![auth-continue dark-1180](auth-continue/dark-1180.jpg)

**light-390** (2.5%)  
![auth-continue light-390](auth-continue/light-390.jpg)

**dark-390** (2.5%)  
![auth-continue dark-390](auth-continue/dark-390.jpg)

## customers-list

**light-1180** (1.6%)  
![customers-list light-1180](customers-list/light-1180.jpg)

**dark-1180** (1.6%)  
![customers-list dark-1180](customers-list/dark-1180.jpg)

**light-390** (2.4%)  
![customers-list light-390](customers-list/light-390.jpg)

**dark-390** (2.4%)  
![customers-list dark-390](customers-list/dark-390.jpg)

## chat-dms

**light-1180** (2.4%)  
![chat-dms light-1180](chat-dms/light-1180.jpg)

**dark-1180** (2.4%)  
![chat-dms dark-1180](chat-dms/dark-1180.jpg)

**light-390** (0.0%)  
![chat-dms light-390](chat-dms/light-390.jpg)

**dark-390** (0.0%)  
![chat-dms dark-390](chat-dms/dark-390.jpg)

## auth-desktop

**light-1180** (0.5%)  
![auth-desktop light-1180](auth-desktop/light-1180.jpg)

**dark-1180** (0.5%)  
![auth-desktop dark-1180](auth-desktop/dark-1180.jpg)

**light-390** (2.1%)  
![auth-desktop light-390](auth-desktop/light-390.jpg)

**dark-390** (2.1%)  
![auth-desktop dark-390](auth-desktop/dark-390.jpg)

## my-settings-desktop

**light-1180** (0.2%)  
![my-settings-desktop light-1180](my-settings-desktop/light-1180.jpg)

**dark-1180** (0.2%)  
![my-settings-desktop dark-1180](my-settings-desktop/dark-1180.jpg)

**light-390** (0.7%)  
![my-settings-desktop light-390](my-settings-desktop/light-390.jpg)

**dark-390** (0.7%)  
![my-settings-desktop dark-390](my-settings-desktop/dark-390.jpg)

## layout-activity

**light-1180** (0.0%)  
![layout-activity light-1180](layout-activity/light-1180.jpg)

**dark-1180** (0.0%)  
![layout-activity dark-1180](layout-activity/dark-1180.jpg)

**light-390** (0.0%)  
![layout-activity light-390](layout-activity/light-390.jpg)

**dark-390** (0.0%)  
![layout-activity dark-390](layout-activity/dark-390.jpg)

## layout-my-settings

**light-1180** (0.0%)  
![layout-my-settings light-1180](layout-my-settings/light-1180.jpg)

**dark-1180** (0.0%)  
![layout-my-settings dark-1180](layout-my-settings/dark-1180.jpg)

**light-390** (0.0%)  
![layout-my-settings light-390](layout-my-settings/light-390.jpg)

**dark-390** (0.0%)  
![layout-my-settings dark-390](layout-my-settings/dark-390.jpg)

## channel-sidebar

## notifications-all

**light-1180** (0.0%)  
![notifications-all light-1180](notifications-all/light-1180.jpg)

**dark-1180** (0.0%)  
![notifications-all dark-1180](notifications-all/dark-1180.jpg)

**light-390** (0.0%)  
![notifications-all light-390](notifications-all/light-390.jpg)

**dark-390** (0.0%)  
![notifications-all dark-390](notifications-all/dark-390.jpg)

## dms

## modal-change-role

## activity

## channel

## layout-chat

**light-1180** (0.0%)  
![layout-chat light-1180](layout-chat/light-1180.jpg)

**dark-1180** (0.0%)  
![layout-chat dark-1180](layout-chat/dark-1180.jpg)

**light-390** (0.0%)  
![layout-chat light-390](layout-chat/light-390.jpg)

**dark-390** (0.0%)  
![layout-chat dark-390](layout-chat/dark-390.jpg)

## notifications

**light-1180** (0.0%)  
![notifications light-1180](notifications/light-1180.jpg)

**dark-1180** (0.0%)  
![notifications dark-1180](notifications/dark-1180.jpg)

**light-390** (0.0%)  
![notifications light-390](notifications/light-390.jpg)

**dark-390** (0.0%)  
![notifications dark-390](notifications/dark-390.jpg)
