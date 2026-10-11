# Notification Hub

English · [简体中文](README.zh-CN.md)

After you leave a conversation, things keep happening. A reply finishes, a channel receives a message, a background task ends, and somewhere an error may surface.

Notification Hub keeps those events on the desktop:

- a quiet popup at the lower right when it happens
- a place to find it again when you miss it

It **delivers** and it keeps a **record**. It does not pull Hana back to the front, and it does not switch you to a conversation.

## 🔔 Where a notification comes from

**Three sources: a conversation ending, a channel message, a status change.**

**A conversation ending** is the most common: an agent has finished a reply. Tool calls, a run you cancelled, and a reply that ended in an error do not pretend to be「回复好了」.

**A channel message** says who and where.

- If ordinary messages in one channel pile up in a short stretch, it gathers them into a single summary instead of raining across your desktop.
- An important message does not join the gathering and appears on its own straight away.

**A status change** covers a scheduled task finishing, an activity changing state, and errors while things run. Tool errors, an unavailable model, and rate limits all belong to this group, and errors and failures appear as the more important kind of notification.

There is also a quiet rule: write a few keywords in the settings, and any notification that matches one is raised to an **important notification** and uses the sound reserved for them.

## 🖥️ How it reaches you

**The popup appears at the lower right of the desktop, drawn by the app itself.**

Not a native Windows banner, and it plays whatever sound the current settings select. Click it and it folds away, and that row is marked **「刚点开」** in the notification page.

Sometimes it should stay silent, for instance:

- a **quiet-hours** span you set
- one conversation or one channel you have muted
- **「只记录到列表」** chosen

In all of these the notification is still written to the list; it simply does not interrupt you.

The popups have an order among themselves. One that is leaving no longer blocks clicks; from bottom to top you see the particles, then the popups that are leaving, then the popups that are on screen.

## 🗂️ After you miss it: the notification center

**Two ways in, and they open the same page.**

- **「通知中心」** in Hana's settings
- **「通知🌸配置」** in the card center

The page holds two things: the **notification list**, and the **settings** for this page.

The list filters by all, conversation, channel, status, and important; it refreshes, it clears, and it can mute the source of a single row in place.

History keeps at most **200 records**, and how many the list shows is yours to set. Consecutive replies in the same conversation within 60 seconds share one row and show how many were merged — the switch is called **「六十秒合并」** and is on by default.

On the desktop each reply still gets its own popup and its own sound; only the row is shared. After it is turned off, later replies each take their own row, and rows that were already merged stay merged.

A conversation's name comes only from the title in the host's session list. When there is a title, the name and the session id are stored together; when there is none, the row says **「未命名会话」** and the app does not invent a name.

## 🎛️ What you can adjust

**Sounds, appearance, and rhythm — all on this one page.**

**Sounds** are split by source: conversation, channel, important notifications, and status/fallback each have their own. Any of them can use one of the built-in sounds, be silenced, or point at a file of your own (wav, mp3, m4a, aac, wma; a file that will not play falls back to a built-in sound).

**Appearance** is a set. One visual pack rewrites the card style, the entrance, the particles, the motion, the feel, the colors, and the panel theme at once. To tune it by hand, each of these can still be changed one by one:

- layout, card style, colors
- scale, offsets, dance style, physics feel
- entrance effect, particle shape and track
- particle count and size

The panel itself has three text sizes and an option to tint notifications by source.

**Rhythm** lives on the same page: quiet hours, muted sources, display mode, and whether a click highlights the row.

The settings page can also preview each kind of popup — a single one, a rapid burst, a channel summary, a status notice, an error, a finished task — before you decide.

## 🚫 Limits of this version

These are things this version does not do.

- Clicking a popup or a list row does **not switch back to a conversation**, and it does not raise or restore Hana's main window
- There is no sidebar entry, and there is no end-of-day review
- The extension details page cannot turn **「通知中心」** and **「通知🌸配置」** on or off separately
- The popup helper is currently Windows only

## 📦 Installation

The current version is **0.3.55**. It runs on Windows and needs **HanaAgent >= 0.978.0**. The app id is `notification-hub`.

Place the whole app directory at:

```text
%USERPROFILE%\.hanako\apps\notification-hub
```

Put it under `apps`, not under `plugins`. To move it to another machine, copy the entire `notification-hub` directory to the same place, then open it from either of the two entries above.
