# Notification Sound Files

This directory contains notification sound files for the application.

## Current Files

- `notification01.mp3` - Classic notification
- `notification03.mp3` - Modern alert

## Active Sound Catalog

The notification system currently supports two production sounds:

- `notification01`
- `notification03`

## Where to Find Free Notification Sounds

### Recommended Sources (Royalty-Free):

1. **Pixabay** - https://pixabay.com/sound-effects/search/notification%20chime/
    - 1,134+ royalty-free notification chime sound effects
    - Free to download and use

2. **Mixkit** - https://mixkit.co/free-sound-effects/bell/
    - 36+ free bell sound effects
    - All sounds are royalty-free

3. **ZapSplat** - https://www.zapsplat.com/music/ui-alert-notification-bell-chime-ping-6/
    - Free UI alert and notification sounds
    - Requires free account

4. **Uppbeat** - https://uppbeat.io/sfx/category/notifications/ping
    - Free ping sound effects
    - No copyright issues

## File Requirements

- **Format**: MP3
- **Duration**: 0.5-2 seconds recommended
- **Size**: Keep under 100KB for fast loading
- **Quality**: Clear, non-distorted audio

## Adding New Sounds

To add new notification sounds to the app:

1. Add the MP3 file to this directory
2. Update the schema in `apps/web-foldkit/src/notification-sound.ts`
3. Add the option to the sound list in `apps/web-foldkit/src/page/my-settings/notifications/view.ts`
