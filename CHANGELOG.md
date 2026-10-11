# Changelog

## 0.3.55 - 2026-10-09

### Changed

- Notification card face is `ui/face-4.png`. `ui/face-3.png` stays in the folder. `face.image` points at `face-4.png`.
- The toast helper is split by responsibility. Drawing, entrance lights, the four card styles, particle shapes, and particle colors are unchanged.
- Host settings for this app open `widget.html`. Product config writes go through `writeHostConfig`.
- New history rows store `sourceLabel` and `meta.sourceKind`. The list shows a session title or a channel name. Toast click still only highlights the row and does not open the chat.
- The JS manager client lives in `lib/toast-manager-client.js`. Shared field normalizers live in `lib/toast-fields.js`. `CustomToast` remains the launcher.
- Channel aggregation lives in `lib/channel-aggregation.js`. The plugin methods stay, including `_resolveChannel` and `_channelAggregation`.
- Conversation replies are assembled in `lib/conversation-notification.js`. Session titles come from the host session list. An untitled host session is shown as 未命名会话. A titled host session also stores its session id. Replies from the same session within 60 seconds share one list row while 六十秒合并 is on; each reply still shows its own toast and plays its own sound. Toast click does not switch sessions.
- Error, scheduled-task, and activity notifications live in `lib/status-notification.js`. The generic `notification` event remains in `_handleEvent`.
- Recording and showing a toast live in `lib/notification-delivery.js`. Quiet hours still read `plugin._now`. Toast click still only writes the click log and stays in `index.js`.

## 0.3.54 - 2026-10-08

### Changed

- Notification card face is a newly generated illustration at `ui/face-3.png`, measured 2352×3520. The filename is new so the card does not keep the previous cover.

## 0.3.53 - 2026-10-08

### Changed

- Notification card face is now `ui/face-2.png`, the same declaration HanaCC uses: `face.image` is `face-2.png`, 2352×3520.

## 0.3.52 - 2026-10-08

### Changed

- Notification card face is `ui/assets/notice-face-hana-face3.png` at 2352×3520. The 4096-tall file stayed sharp on the first open and went soft on the second, so this uses the size that stayed sharp, under a new filename.

## 0.3.51 - 2026-10-08

### Changed

- Notification card face is `ui/assets/notice-face-hana-face2.png` at the measured 2737×4096. The filename is new so the card does not keep a cached cover. The file is a normal PNG, not a pre-shrunk bitmap.

## 0.3.50 - 2026-10-08

### Changed

- Notification card face is now `ui/assets/notice-face-hana-sharp.webp`, a lossless WebP of the sharper 2737×4096 generation. The host still serves the original file; it is not pre-shrunk.

## 0.3.49 - 2026-10-08

### Changed

- Notification card face is now `ui/assets/notice-face-hana.webp` at the original 2737×4096. The host cover contract is png, webp, or svg, and the file was not pre-shrunk.

## 0.3.48 - 2026-10-08

### Changed

- Notification card face is the same warm morning illustration at 2352×3520, replacing the 1360×2048 face.

## 0.3.47 - 2026-10-08

### Changed

- Card title is 通知🌸配置. The bracketed old mark was removed because the card clipped it.

## 0.3.46 - 2026-10-08

### Changed

- Notification card face is the warm morning illustration: side light, pale blue kimono, a cream letter on the table. The card title was 通知🌸配置[old].

## 0.3.42 - 2026-10-07

### Changed

- App card cover is one warm sheet on a dark ground. A crease catches the light, and the gold dot sits on the right edge. Both `assets/cover.svg` and `ui/assets/cover.svg` are the same drawing, so the host no longer stretches the icon.

## 0.3.41 - 2026-10-07

### Changed

- The 刚点开 hint is now a small square button in the page accent, matching the save button, so the highlight reads as a label instead of a bare word.

## 0.3.40 - 2026-10-07

### Changed

- The last opened notification still uses the accent wash and left bar, and now says 刚点开 so the mark is not mistaken for another notification type.

## 0.3.39 - 2026-10-07

### Fixed

- A saved panel theme is no longer rewritten to 经典柔和 when the page is opened again. An explicit theme is painted even if the visual catalog has not loaded, and hidden setting menus keep the saved choice instead of the first option.

## 0.3.38 - 2026-10-07

### Fixed

- App card cover now lives at `assets/cover.svg`, the path the host actually loads. The previous drawing was only in `ui/assets/`, so the card center stretched the icon into bands.

## 0.3.37 - 2026-10-07

### Changed

- Redesigned app icon and card cover. Icon now shows a notification paper emerging from an envelope corner with a glowing indicator dot. Cover shows three stacked translucent notification cards with soft glows.
- Shortened manifest description to fit card layout without truncation.
- Enhanced notification center widget interactive affordances: filters, tabs, list items, mute buttons, and action buttons now have visible hover states with underlines, color shifts, and subtle shadows.
- Improved click target consistency: hover areas now match visual boundaries for all interactive elements.
- Fixed text contrast and overflow issues in notification list items.

## 0.3.36 - 2026-10-07

### Fixed

- Gradient entrance no longer crashes the helper. GDI+ rejects a clamped gradient brush, so the fading edge is drawn as short strips instead.
- Cloud entrance eases in over the first third of the slide instead of popping on at full size.

## 0.3.35 - 2026-10-07

### Changed

- Redesigned veil-clear entrance light. Now starts with a solid veil covering the card, then fades out from right to left (right side clears first, left side last) with a soft gradient edge. Uses a continuous alpha gradient instead of discrete shapes.
- Redesigned cloud-burst entrance light. Each cloud layer is now drawn as a recognizable cloud contour using GraphicsPath with three rounded humps on top and a flat base, creating clear ☁️ shapes. Clouds appear instantly (0-0.12 progress), then drift with larger motion (up to 18% card width) and fade slowly through the remainder (0.12-0.88) with ease-out curve.

## 0.3.34 - 2026-10-07

### Changed

- Redesigned cloud-burst entrance light. Each cloud layer is now a connected contour with multiple humps and a base, creating recognizable cloud shapes rather than separate ellipses. Clouds appear instantly (0-0.15 progress), then drift slowly with visible horizontal and vertical motion through the remainder of the entrance window (0.15-0.88), fading with an ease-out curve.
- Redesigned veil-clear entrance light. Now draws a continuous half-transparent veil across the entire card that clears from right to left with a soft feathered gradient edge, rather than moving shapes or scan lines.

## 0.3.33 - 2026-10-07

### Changed

- Refined cloud-burst and veil-clear entrance lights. Cloud-burst now has six layers with different scales, individual fade delays, and subtle horizontal drift to create a layered fog effect. Veil-clear replaced vertical scan lines with overlapping soft ellipses that clear from right to left with a feathered edge and slight color shift.

## 0.3.32 - 2026-10-07

### Added

- Added four new entrance lights: metal-sweep (金属掠光), triangle-bloom (三角绽放), veil-clear (渐变揭幕), cloud-burst (云雾缭绕). All use the soft-edge SoftLayer technique introduced in 0.3.31.

## 0.3.31 - 2026-10-07

### Changed

- Replaced the six entrance lights rejected in 0.3.30. The old PathGradient ellipses and thick pen strokes drew hard edges that looked bad in the actual toast window. New lights: ripple-bloom (波纹绽放), edge-glow (边缘微光), breath-fade (呼吸淡入), comet-trail (彗尾划过). Each is painted into a small bitmap, scaled up with bilinear interpolation for soft edges, then clipped into the rounded card. Default changed to ripple-bloom.
- Combo packs re-paired to match their stated character. Unknown ids, older retired ids, and the twelve ids from 0.3.30 and 0.3.30-reject all fall back to ripple-bloom. A retired entrance id no longer blocks a combo pack's entrance assignment.

## 0.3.30 - 2026-10-07

### Changed

- Replaced the six entrance lights. The old glow, fade, gather, scan, stardust, and prism drawings are gone. New lights are dew-well, crescent-lift, thread-snap, curtain-sway, comet-wake, and arc-return. Combo packs use the new set. Unknown and retired ids fall back to dew-well.

## 0.3.29 - 2026-10-07

### Changed

- Host settings option labels for registry-backed choices are now checked against the visual registry, including toast layout. Display mode, density, and card exit stay page-owned.

## 0.3.28 - 2026-10-07

### Changed

- The notification page no longer embeds a frozen copy of combo packs or effect options. It reads both from `GET /visual-catalog`, which returns the registry.

## 0.3.27 - 2026-10-07

### Changed

- Status monitoring no longer gates errors or task-done notices. Each switch acts alone. Status monitoring now only controls status notices relayed from Hana.
- Rebuilt `notification-toast-helper.exe` from the current helper source.

## 0.3.26 - 2026-10-07

### Changed

- Host settings now use the notification page's names and descriptions. Combo copy no longer says particle stickers. Display-mode labels match the page. Error and task-done copy says they also stop when status monitoring is off.
- Stopped sending the unused butterfly count. The helper source no longer parses that field, the old dismiss effect, or an unused slot path. The running helper was not rebuilt.

## 0.3.25 - 2026-10-07

### Changed

- Settings copy now matches the switches. Status monitoring is described as the master gate. The status sound is named as the fallback, not an important-notification theme. Turning particles off no longer claims the card only fades. Toast color no longer says sakura.

## 0.3.24 - 2026-10-07

### Changed

- Host settings now use the page's names. The old widget, dismiss-particle, and exit-physics wording is gone. Auto panel theme is described as following the host, and only then a combo pack.

## 0.3.23 - 2026-10-07

### Changed

- Retired the old light/dark widget theme setting. A stored light or dark value still becomes the classic or obsidian panel theme when no panel theme is set, but the field is no longer shown or saved.

## 0.3.22 - 2026-10-07

### Changed

- Removed the unused card-exit trajectory switch. The card still slides back the way it came in. Particle motions are unchanged. The running helper was not replaced.

## 0.3.21 - 2026-10-07

### Changed

- Retired the legacy dismiss-animation setting. Old configs still migrate a stored particle shape from that field when the shape itself is missing, but the field is no longer shown, saved, or sent to the toast.

## 0.3.20 - 2026-10-07

### Changed

- Card exit is now named 滑回右侧, because it reverses the entrance instead of following a selected trajectory. The two particle motions moved into the particle group and are named 自动粒子轨迹 and 手动粒子轨迹.

## 0.3.19 - 2026-10-07

### Changed

- Card slide and fade now share one 640ms clock and finish together. The card no longer finishes moving and then waits for the fade.

## 0.3.18 - 2026-10-07

### Changed

- Card trajectory now reverses the entrance: the card came in from the right, so it slides back to the right. It no longer leaves upper-right. Particles still follow the selected dismiss motion.
- Fade lasts about 1200ms with a smoothstep, so the dissolve stays visible. Instant fade uses the same clock and does not move the card.

## 0.3.17 - 2026-10-07

### Changed

- Card exit now has two independent choices: follow the selected trajectory, or vanish in place; fade, or stay opaque until it closes. Defaults remain trajectory plus fade. Combo packs do not overwrite either choice. Instant with no fade closes after particles are emitted. Instant with fade stays put and fades in about 220ms.

## 0.3.16 - 2026-10-07

### Changed

- Every card exit leaves without a reverse feint. Magnet snap no longer pulls upper-left before shooting right, pixel rain no longer steps left, and vortex and orbit stay arcs that do not cross back left of the start. The card still does not rotate. Particles are unchanged.
- Card exit is 460ms. The fade is a smoothstep across that window, not a fast drop followed by a long ghost.

## 0.3.15 - 2026-10-07

### Fixed

- Manual dismiss on shatter-lines no longer bobs the card up and down. The card slides straight out; the crack stays on the particles.
- The first particle burst no longer scans the bake canvas one byte at a time, and the GPU device is created when the helper starts instead of on the click that releases particles.

## 0.3.14 - 2026-10-07

### Changed

- The notification center page is redrawn to the accepted page spec: six color roles, a ten-group settings directory, and no outer radius, shadow, or second frame. Toasts and particles are unchanged.

## 0.3.13 - 2026-10-07

### Changed

- The notification page now has switches for click highlight and particle exit. Clicking a toast highlights its record; it does not open a chat. Turning particle exit off fades the card and releases no particles. The old dismiss field no longer chooses the particle shape.
- Quiet hours and per-session mute suppress the popup only. The notification is still recorded. Preview is unchanged.

## 0.3.12 - 2026-10-07

### Changed

- Card exit displacement now lives in `ToastExitMotion`, and particle motion now lives in `ParticleMotionRegistry`. The formulas are unchanged. The running helper was not replaced.

## 0.3.11 - 2026-10-07

### Changed

- Settings, the card routes, and test-notify now read host config through one function. A toast sent while that read is still pending waits, and uses the config that comes back. Dismiss-motion aliases and the dark panel and host-dark name lists each live in one table. Toast colors, particles, and dismiss motion are unchanged.

## 0.3.10 - 2026-10-07

### Changed

- The notification card is only `ui/widget.html`. It follows the host theme and pauses while hidden. The duplicate HTML page on `GET /widget` is gone. Toast colors, particles, and dismiss motion are unchanged.

## 0.3.9 - 2026-10-07

### Changed

- The toast card now follows the selected dismiss motion. Drift lifts, gravity falls, bubbles rise, gusts push, and a click recoils away from the pointer. Particle count, size, and the sprite batch are unchanged.

## 0.3.8 - 2026-10-07

### Fixed

- Settings save now waits for the host config write, and reopening the app page reads the stored values instead of treating the pending read as an empty config.

## 0.3.7 - 2026-10-07

### Fixed

- Full-size bursts from several toasts are composited with a Direct2D sprite batch instead of one GDI+ draw per particle. The baked sprites, count, size, and motion are unchanged. If the GPU path cannot start, the previous blit remains.

## 0.3.6 - 2026-10-07

### Fixed

- Hover-pause uses the same rounded card as the click, including while the pointer is still inside the transparent canvas padding.
- Max particle size no longer sizes the blit from `(Radius + constant) * Scale`. Both values already include the size slider, so ten full bursts were clearing a near-screen surface every frame. The surface also shrinks once the live particles occupy less than half of it.

## 0.3.5 - 2026-10-07

### Changed

- The toast card is now a per-pixel layered window. Entrance and exit fade that bitmap instead of changing `Form.Opacity` on a color-key surface, so the rounded edge can be soft and the exit no longer repaints the card.

## 0.3.4 - 2026-10-07

### Changed

- Dismiss particles no longer repaint a virtual-screen transparency-key window. Each shape is rasterized once with anti-aliasing and blitted onto a tight layered surface, so large counts stay smooth without dropping particle count, size, or motion. Edges can be soft again because the overlay no longer uses a color key.

### Fixed

- The layered particle window was scaled by DPI a second time. On this PerMonitorV2 display the coordinates are already screen pixels, so the burst was placed past the bottom-right corner and nothing showed.

## 0.3.3 - 2026-10-07

### Fixed

- Toast manager no longer depends on TCP. A v2 app process has no `--allow-net`, so the handshake always failed, each preview waited about 2.5s, and every card was a separate process at slot 0. Commands now go through a file queue in app data, so one manager owns stacking again.
- The helper sets PerMonitorV2 itself. Inheriting the app host's DPI awareness stretched the borderless window and broke the transparency key, which made the card too wide and placed it wrong.

## 0.3.2 - 2026-10-07

### Fixed

- Event subscription now passes an empty filter. Omitting it made the v2 host send `null`, and `EventBus.subscribe` then crashed the load with `Cannot read properties of null (reading 'types')`.

## 0.3.1 - 2026-10-07

### Fixed

- App v2 has no host-injected `register`. The class now keeps its own disposables, so approving the app no longer dies in `onload` with `this.register is not a function`.

## 0.3.0 - 2026-10-06

### Changed

- Moved the running plugin onto App v2. The old v1 plugin is left in place until this app is approved and the v1 copy is disabled.
- Custom toasts still spawn `notification-toast-helper.exe` and now require `app/process.spawn`. Native mode uses `ctx.notifications.show` instead of emitting a host `notification` event.
- The history card is a v2 app card. It calls `/api/apps/notification-hub/routes` with the surface session, and no longer asks the host to open a conversation on click.

## 0.2.3 - 2026-10-06

### Changed

- Fitted the notification panel to the Hana 1.0 card frame. The widget now declares `cardForm: "fill"`, so the host stops drawing a second framed panel and a solid title over the page.
- When the panel theme is `auto` and the combo pack does not lock a theme, the page follows the host `hana-theme-appearance` instead of staying on the light classic tokens.
- On that new host frame, the page no longer asks the parent to grow with `resize-request`, drops the old 260px minimum width, and uses a larger type scale once the card is wider than the old sidebar.

## 0.2.2 - 2026-08-23

### Fixed

- Removed the empty string from `list-notifications.type.enum`; Gemini-compatible providers reject empty enum values.
- Kept `type` optional so omitting it still returns notifications across all types.

### Validation

- Added a schema regression check for empty enum values and unsupported `const`/`deprecated` fields.


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
