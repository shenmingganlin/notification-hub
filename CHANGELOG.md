# Changelog

## 0.2.1 - 2026-06-06

### Fixed

- Fixed the release zip layout so `manifest.json` is placed at the archive root for direct manual installation into `%USERPROFILE%\.hanako\plugins\notification-hub`.
- Added a release packaging script with zip-root validation to prevent nested `notification-hub/manifest.json` archives.
- Updated install docs to reference `notification-hub-0.2.1.zip`.

### Validation

- `npm run check`
- `npm test`
- `npm run package:release`

## 0.2.0 - 2026-06-05

### Added

- Added multi-layout custom toast cards: `hero`, `clean`, `headline`, `dialogue`, and `timeline`.
- Added global toast scaling with adaptive text, avatars, spacing, rounded corners, entrance visuals, and particle sizing.
- Added configurable toast X/Y offsets with support for pushing toasts outside the visible work area.
- Added tight physical stacking based on the visible card height instead of the transparent canvas height.
- Added richer visual combo packs that can also drive panel themes.
- Added `panelTheme` for the notification widget panel, with `auto` mode that follows the selected visual combo pack.
- Added panel themes: `classic`, `minimal`, `glass`, `tech`, `aurora`, `sakura-storm`, `obsidian`, `hologram`, `paper`, `ember`, and `moonlight`.
- Added custom conversation/channel/status sound paths with WPF MediaPlayer fallback for MP3 and other media formats.
- Added toast manager token/port lifecycle hardening and runtime regression checks.
- Added focused sound-system and runtime-regression test scripts.

### Changed

- Reorganized the widget settings page into clearer groups: notification method, sound, visual combo pack, toast card, motion, particles, panel, channel aggregation, and important rules.
- Replaced legacy widget light/dark wording with the new panel theme model while preserving `notificationWidgetTheme` backward compatibility.
- Improved README coverage for the final visual system, panel themes, sound routing, and release workflow.
- Updated package and manifest version to `0.2.0`.

### Fixed

- Fixed custom MP3 notification sound playback by adding a WPF media fallback path.
- Fixed managed toast manager lifecycle issues around token/port persistence, ping/pong, and queued create acknowledgements.
- Fixed text scaling by drawing toast text through the scaled Graphics layer.
- Fixed particle source and size scaling when toast scale changes.
- Fixed overly large physical gaps between stacked toasts.
- Fixed offset clamping so user-configured offsets can intentionally move toasts beyond the work area.

### Validation

- `npm run check`
- `npm test`
- `dotnet build helper/NotificationToastHelper.csproj -c Release`
- `dotnet publish helper/NotificationToastHelper.csproj -c Release -o helper/publish`
