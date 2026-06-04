# 🌸 Notification Hub for HanaAgent

<p align="center">
  <b>Turn HanaAgent notifications into a tiny desktop visual engine.</b><br />
  Agent replies, channel messages, task failures, keyword alerts, notification history, custom toast physics, particle exits, visual combo packs, and a widget dashboard, all packed into one full-access Hana plugin.
</p>

<p align="center">
  <img alt="HanaAgent" src="https://img.shields.io/badge/HanaAgent-%E2%89%A5%200.158.0-ff7ab6" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-4f8cff" />
  <img alt="Plugin" src="https://img.shields.io/badge/plugin-full--access-f6c177" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-7bd88f" />
</p>

> This is what happens when a notification plugin stops behaving like a gray system popup and starts behaving like a living desktop creature.

---

## ✨ What is this?

**Notification Hub** is a desktop notification center for [HanaAgent](https://github.com/liliMozi/openhanako).

It listens to HanaAgent events and turns them into beautiful, configurable, clickable notifications:

- conversation finished
- channel message arrived
- important keyword hit
- background task done
- error / failure / status alert
- manual test notification
- notification history in a compact widget

And then it goes much further: custom toast windows, spring stacking, particle exits, role-colored themes, preview-friendly visual packs, sound themes, channel aggregation, source tinting, and a real notification store.

If HanaAgent is your agent cockpit, Notification Hub is the glowing instrument panel that tells you what just happened without making you dig through logs.

---

## 🔥 Feature blast

### 🎭 Custom desktop toast renderer

Notification Hub ships with a Windows helper renderer and uses it to display custom desktop toasts instead of plain system notifications.

You get:

- right-bottom floating toast cards
- clickable notifications
- managed toast stacking
- TCP delivery path for fast toast dispatch
- fallback file delivery path
- clean unload / manager lifecycle handling
- independent and managed transport modes

### 🌈 Visual combo packs

One dropdown can transform the whole notification personality:

| Pack | Mood |
| --- | --- |
| `magicAir` | glass, bubbles, soft magic motion |
| `cyberBurst` | neon tech, pixel rain, sharp impact |
| `auroraPrism` | prism entrance, rainbow palette, orbit decay |
| `physicalToys` | playful physics, windmills, exaggerated motion |
| `sakuraOverdrive` | high-density sakura storm, wild physics |
| `blackGoldMachine` | obsidian card, metal gears, black-gold palette |
| `emberComet` | hologram card, comet particles, ember glow |
| `moonlitHolo` | moonlight palette, crescent particles, soft hologram |

Combo packs are **templates, not locks**. Pick a pack, then override individual fields like card style, particle shape, entrance visual, motion track, or palette.

### 💥 Particle exits and motion tracks

The toast does not merely disappear. It leaves.

Particle shapes include:

```text
moss, sakura, snowflake, butterfly, bubble, windmill, star, spark,
shard, leaf, pixel, comet, gear, ember, crescent, slash
```

Dismiss motion tracks include:

```text
drift, circle-burst, rect-burst, x-burst, vortex, ribbon-flow,
gravity-fall, orbit-decay, bubble-rise, windmill-gust, shatter-lines,
pixel-rain, magnet-snap
```

Manual dismiss also supports:

```text
click-burst
```

So automatic timeout and user click can have different physics and visual language.

### 🧠 Smart event routing

Notification Hub understands multiple HanaAgent event types:

- `message_end` for finished agent replies
- `channel_new_message` for channel traffic
- `notification` for engine/native notify takeover
- `error`, `cron_job_done`, `activity_update` for status monitoring

It avoids common notification traps:

- skips tool-call-only `message_end`
- skips aborted replies
- skips subagent internal sessions
- skips phone bridge internal sessions
- avoids self-recursive notification takeover
- filters system senders

### 🚦 Importance and keyword alerts

Important messages can be promoted automatically by keyword.

Default examples:

```text
紧急, bug, 报错, 失败, 完成了, error, failed
```

Important notifications can use stronger visuals and sounds without making every normal message noisy.

### 🧺 Channel aggregation

Busy channels can flood a desktop. Notification Hub can aggregate ordinary channel messages inside a time window, while still letting important messages break through immediately.

Configurable knobs:

- aggregation enabled / disabled
- aggregation window seconds
- aggregation threshold

### 🪟 Notification widget

The plugin contributes a Hana widget titled **通 / Notifications**.

It provides a notification history panel with:

- conversation / channel / status records
- optional source tinting
- light / dark / auto theme
- large, spacious reading density
- clear notifications tool
- list notifications tool

### 🔊 Sound themes

Choose the sound personality:

```text
ding, chime, notify, system, alert, alarm, off
```

Conversation, channel, important, and status notification sounds can be configured separately.

---

## 🧩 Architecture

```text
notification-hub/
├─ manifest.json                    # Hana plugin metadata and settings schema
├─ index.js                         # lifecycle, EventBus routing, notification orchestration
├─ lib/
│  ├─ notification-config.js         # config normalization and runtime config
│  ├─ effect-registry.js             # visual packs, styles, motions, particles, themes
│  ├─ custom-toast.js                # custom toast transport and helper manager client
│  ├─ notification-store.js          # persistent notification history
│  └─ agent-resolver.js              # agent identity and theme resolution
├─ routes/
│  └─ widget.js                      # widget HTML route
├─ tools/
│  ├─ test-notify.js                 # Agent-callable test notification
│  ├─ list-notifications.js          # read notification history
│  └─ clear-notifications.js         # clear notification history
├─ helper/
│  ├─ NotificationToastHelper.cs     # Windows toast helper source
│  ├─ NotificationToastHelper.csproj # helper project file
│  └─ notification-toast-helper.exe  # prebuilt Windows helper used by the plugin
└─ scripts/
   ├─ check-notification-config.mjs
   ├─ check-notification-types.mjs
   ├─ check-widget-preview.mjs
   └─ check-test-notify.mjs
```

The important design choice: visual capabilities are centralized in `lib/effect-registry.js`. New styles, particles, motions, themes, and combo packs should be registered there first, then wired into renderer support if needed. This keeps the plugin from becoming a pile of scattered visual branches.

---

## 🚀 Install

### Requirements

- Windows
- HanaAgent `>= 0.158.0`
- Plugin full-access permission enabled for this plugin

### Manual install

Clone or download this repository into Hana's plugin directory:

```text
%USERPROFILE%\.hanako\plugins\notification-hub
```

Then enable/reload the plugin from HanaAgent's plugin settings.

For development, install the source directory through HanaAgent's plugin dev tools. The plugin id is:

```text
notification-hub
```

---

## 🧪 Test

Run the focused validation suite:

```bash
node --check index.js
node --check routes/widget.js
node --check tools/test-notify.js
node --check lib/custom-toast.js
node --check lib/effect-registry.js
node --check lib/notification-config.js
node --check lib/notification-store.js
node --check lib/agent-resolver.js
node --check scripts/check-notification-config.mjs
node --check scripts/check-notification-types.mjs
node --check scripts/check-widget-preview.mjs
node --check scripts/check-test-notify.mjs
node --check .smoke-channel-aggregation.mjs
node --check .smoke-status-notifications.mjs

node scripts/check-notification-config.mjs
node scripts/check-notification-types.mjs
node scripts/check-widget-preview.mjs
node scripts/check-test-notify.mjs
node .smoke-channel-aggregation.mjs
node .smoke-status-notifications.mjs
```

Expected output:

```text
notification config checks ok
notification type checks ok
widget preview checks ok
test-notify checks ok
channel aggregation smoke ok
status notifications smoke ok
```

---

## 🛠 Build the Windows helper

A prebuilt helper executable is included for normal plugin use:

```text
helper/notification-toast-helper.exe
```

To rebuild it yourself, install the .NET SDK and run:

```bash
cd helper
dotnet publish -c Release -r win-x64 --self-contained false
```

Then copy the produced executable back to:

```text
helper/notification-toast-helper.exe
```

---

## ⚙️ Configuration highlights

Notification Hub exposes a large settings surface in HanaAgent:

- display mode: custom / native / off
- visual combo pack
- toast card style
- particle shape
- particle count scales
- particle size scale
- entrance visual
- auto dismiss motion
- manual dismiss motion
- physics preset
- toast transport mode
- sound theme
- channel aggregation
- keyword importance
- widget theme
- widget density
- source tinting
- click action

The plugin is designed so presets can give you instant taste, while individual fields remain tweakable.

---

## 🧪 Public tools

Agent-callable tools contributed by this plugin:

| Tool | Purpose |
| --- | --- |
| `notification-hub_test-notify` | Send a test notification using the current display mode |
| `notification-hub_list-notifications` | Read recent notification history |
| `notification-hub_clear-notifications` | Clear stored notification history |

---

## 🔐 Privacy and local data

Notification history is stored locally in the plugin data directory managed by HanaAgent.

This repository does not need API keys, cloud credentials, or external accounts.

Before publishing your own fork, keep these out of git:

- local notification history
- smoke-test data directories
- backup helper executables
- temporary helper builds
- personal HanaAgent data directories

The included `.gitignore` is written for that.

---

## 🧭 Roadmap ideas

- screenshot / GIF gallery for each visual combo pack
- marketplace package metadata
- more helper renderer themes
- optional per-agent visual pack rules
- import/export visual presets
- richer widget filtering
- cross-platform renderer backend if HanaAgent exposes a stable route

---

## 🤝 Contributing

PRs are welcome, especially for:

- new visual combo packs
- new particle shapes
- new motion tracks
- widget UI improvements
- safer lifecycle handling
- tests for config normalization and notification routing

Please keep new visual options centralized in `lib/effect-registry.js` and include a focused test when possible.

---

## 📄 License

MIT License.

---

<p align="center">
  <b>Notification Hub is a notification plugin, a visual toy box, and a tiny desktop event theatre for HanaAgent.</b>
</p>
