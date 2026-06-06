# 🌸 Notification Hub for HanaAgent

<p align="center">
  <b>Still letting Hanako finish replies quietly in the background?</b><br />
  A desktop notification hub for HanaAgent that brings replies, channel messages, task status, and important events right to your screen.
</p>

<p align="center">
  <img alt="HanaAgent" src="https://img.shields.io/badge/HanaAgent-%E2%89%A5%200.158.0-ff7ab6" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-4f8cff" />
  <img alt="Plugin" src="https://img.shields.io/badge/plugin-full--access-f6c177" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-7bd88f" />
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Has this happened to you?

You ask Hanako to think through something.  
Then you switch away, write code, read docs, open far too many browser tabs, and briefly become a different person.

Some time later, you wonder:

> “Wait. Did she finish already?”

You go back.  
She did finish. Gracefully. Quietly. Politely.

A little too politely.

Do you really want your assistant to be that silent?

---

Or maybe a channel is alive with messages.  
Agents are trading context in the corner.  
A background job has completed.  
A tool failed.  
A message containing `bug`, `failed`, or `done` just appeared.

Your desktop, meanwhile, is perfectly calm.

That calm is suspicious.

---

And then there is notification history.

You see a notification flash by, blink once, and immediately forget what it was.

System notification? Gone.  
Chat window? Start digging.  
Log files? Good luck.

Notification Hub exists for exactly this small but annoying gap.

---

## ✨ What is this?

**Notification Hub** is a desktop notification center plugin for [HanaAgent](https://github.com/liliMozi/openhanako).

It turns the things you probably want to know about into notifications that are:

- visible
- clickable
- configurable
- good-looking
- searchable later

Hanako finished a reply?  
It tells you.

A channel received a message?  
It tells you.

A background task completed or failed?  
It tells you.

An important keyword appeared?  
It tells you.

You missed the popup?  
It keeps a record.

Think of it as a tiny front desk for HanaAgent.  
Or a desktop radar.  
Or, if you enable enough particles, a very enthusiastic little notification creature.

The point is simple:

> Important events should not disappear quietly into the background.

---

## 🔥 What can it do?

### 🎭 Make completed replies visible

When Hanako finishes replying, Notification Hub can show a custom desktop toast.

Not just a gray system popup.  
A configurable card with layout, scale, offset, sound, motion, particles, and style.

Keep it calm.  
Make it flashy.  
Your desktop, your rules.

### 💬 Make channel messages less dependent on luck

Channels can notify you when new messages arrive.

If a channel gets busy, Notification Hub can aggregate messages instead of turning your desktop into a notification machine gun.

> Quiet channel: individual reminders.  
> Busy channel: summary notification.

Polite chaos.

### 🚦 Promote important messages automatically

Ordinary messages can stay soft.  
Important ones should stand out.

Keyword examples:

```text
urgent
important
bug
error
failed
done
紧急
重要
报错
失败
完成了
```

When a keyword matches, the notification can become important and use stronger visuals or sounds.

Most of the time, it is a front desk.  
When something breaks, it becomes an alarm.

### 🧺 Keep notification history

A notification should not be a shooting star.

Notification Hub contributes a widget:

```text
通 / Notifications
```

It can show:

- conversation notifications
- channel notifications
- status notifications
- error notifications
- important alerts

Missed it?  
It is in the basket.

### 🌈 Make notifications look like they belong in HanaAgent

Notification Hub includes visual combo packs:

```text
magicAir
cyberBurst
auroraPrism
physicalToys
sakuraOverdrive
blackGoldMachine
emberComet
moonlitHolo
```

Want glassy softness? Yes.  
Cyber neon? Yes.  
Sakura overload? Somehow, also yes.  
Black-gold machine vibes? Absolutely.

Toasts can also disappear with particles and motion instead of simply vanishing.

They can drift, burst, fall, rise, shatter, magnet-snap, or turn into pixel rain.

If a notification must interrupt you, it may as well do it with taste.

### 🧩 Choose a toast layout

Supported toast layouts:

```text
hero
clean
headline
dialogue
timeline
```

The default is `clean`: readable, balanced, and not trying too hard.

### 🎨 Theme the notification panel

The notification widget supports panel themes:

```text
auto
classic
minimal
glass
tech
aurora
sakura-storm
obsidian
hologram
paper
ember
moonlight
```

With `auto`, the panel can follow the selected visual combo pack, so the popup and the history panel feel like they came from the same world.

### 🔊 Give sounds a personality

Sound themes:

```text
ding
chime
notify
system
alert
alarm
custom
off
```

Custom sound formats:

```text
wav
mp3
m4a
aac
wma
```

Conversation, channel, status, and important notifications can use different sound strategies.

Technically, your notifications can have their own theme song.  
Use this power responsibly.

---

## One-sentence summary

Notification Hub is the notification butler for HanaAgent.

It nudges you when:

- Hanako finishes a reply
- a channel receives a message
- a background task ends
- a tool or workflow fails
- an important keyword appears
- system status changes

And it does so with:

- visual hierarchy
- sound
- clickable actions
- notification history
- enough style to avoid looking like a forgotten system dialog

---

## 🧠 Who is it for?

If you only chat with HanaAgent once in a while, this may be a little luxurious.

If you often:

- let Hanako think in the background
- use channels or agent collaboration
- run background tasks
- want to catch errors and completion states
- care about desktop UI aesthetics
- hate the “what was that notification?” moment

then Notification Hub may quickly become infrastructure.

---

## 🧩 Architecture

```text
notification-hub/
├─ manifest.json                    # Hana plugin metadata and settings schema
├─ index.js                         # lifecycle, EventBus routing, orchestration
├─ lib/
│  ├─ notification-config.js         # config normalization and runtime config
│  ├─ effect-registry.js             # visual packs, styles, motions, particles, themes
│  ├─ custom-toast.js                # custom toast transport and helper manager client
│  ├─ notification-store.js          # persistent notification history
│  ├─ agent-resolver.js              # agent identity and theme resolution
│  ├─ delivery/
│  │  └─ toast-decoration.js         # notification decoration
│  ├─ policy/
│  │  └─ notification-policy.js      # notification policy decisions
│  └─ sound/
│     ├─ sound-decision.js           # sound decision logic
│     ├─ sound-registry.js           # sound theme registry
│     ├─ sound-resolver.js           # sound path resolution
│     └─ windows-sound-picker.js     # Windows sound picker helper
├─ routes/
│  └─ widget.js                      # widget HTML route
├─ tools/
│  ├─ test-notify.js                 # Agent-callable test notification
│  ├─ list-notifications.js          # read notification history
│  └─ clear-notifications.js         # clear notification history
├─ helper/
│  ├─ NotificationToastHelper.cs     # Windows toast helper source
│  ├─ NotificationToastHelper.csproj # helper project file
│  └─ notification-toast-helper.exe  # prebuilt helper
└─ scripts/
   ├─ check-notification-config.mjs
   ├─ check-notification-types.mjs
   ├─ check-widget-preview.mjs
   ├─ check-test-notify.mjs
   ├─ check-sound-system.mjs
   └─ check-runtime-regressions.mjs
```

Core design rule:

> Visual capabilities are registered in `lib/effect-registry.js` first, then consumed by the config system and renderer.

This keeps styles, particles, motions, themes, and combo packs from turning into scattered branches across the codebase.

---

## 🚀 Install

### Requirements

- Windows
- HanaAgent `>= 0.158.0`
- Full-access permission enabled for this plugin

### Manual install

Download the latest release zip:

```text
notification-hub-0.2.1.zip
```

Extract it to:

```text
%USERPROFILE%\.hanako\plugins\notification-hub
```

Then enable or reload the plugin from HanaAgent plugin settings.

### Development install

For development, install the source directory through HanaAgent's plugin dev tools.

Plugin id:

```text
notification-hub
```

---

## 🧪 Test

Syntax checks:

```bash
npm run check
```

Regression tests:

```bash
npm test
```

Build the Windows helper:

```bash
dotnet build helper/NotificationToastHelper.csproj -c Release
```

Publish helper artifacts:

```bash
dotnet publish helper/NotificationToastHelper.csproj -c Release -o helper/publish
```

Current release-candidate validation:

```text
npm run check
npm test
dotnet build helper/NotificationToastHelper.csproj -c Release
dotnet publish helper/NotificationToastHelper.csproj -c Release -o helper/publish
```

---

## ⚙️ Configuration

Notification Hub exposes settings for:

- notification enablement
- custom toast enablement
- notification position
- toast layout
- toast scale
- toast X/Y offsets
- toast card style
- visual combo pack
- particle shape, count, and size
- auto dismiss motion
- manual click dismiss motion
- physics preset
- panel theme
- source tinting
- channel aggregation
- important keywords
- conversation sound
- channel sound
- status/important sound
- custom sound paths

Pick a visual combo pack if you want a quick setup.  
Fine-tune the knobs if you enjoy knobs.

---

## 📦 Release package notes

The source repository stays clean and keeps source files, config, scripts, and documentation.

The release zip additionally includes helper runtime files:

```text
helper/notification-toast-helper.exe
helper/notification-toast-helper.dll
helper/notification-toast-helper.deps.json
helper/notification-toast-helper.runtimeconfig.json
```

This allows manual installs to use the custom desktop toast renderer immediately.

---

## 📝 Changelog

See:

```text
CHANGELOG.md
```

---

## 🛣️ Roadmap

Possible future improvements:

- split the C# helper into clearer modules
- add JS/C# payload schema validation
- more visual combo packs
- more panel filtering options
- finer per-agent notification policies
- visual preset import/export
- screenshot/GIF gallery for visual packs
- cross-platform backend if HanaAgent exposes a stable cross-platform notification API

---

## 🤝 Contributing

Issues, suggestions, and PRs are welcome.

Good contribution areas:

- new toast layouts
- new particle shapes
- new dismiss motions
- new visual combo packs
- widget UI improvements
- config normalization tests
- notification routing tests
- documentation and screenshots

If you want to work on the visual system, start here:

```text
lib/effect-registry.js
```

---

## 📄 License

MIT
