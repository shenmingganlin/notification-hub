# Notification Hub 0.3.55

**This is a generational update, not a small patch.**

Between 0.2.1 and 0.3.55 a whole generation passed. 0.2.1 was still a small widget tucked in a corner: one character, a list behind it, and the occasional popup on the desktop.

In 0.3.55 it has become an app of Hana — with a page of its own, settings of its own, and a delivery path of its own, and for the first time a sense of what deserves to interrupt you and what does not.

What follows is written along the lines you can actually feel.

## 🚪 Where you open it changed

**From a small corner widget to a page that fills the card frame.**

In 0.2.1 the notification center was a small widget in the corner. It now fills the host's card frame, with no second frame inside it, and the notification list and the settings share one row of tabs. The cover is `ui/face-4.png`.

There are two ways in: **「通知中心」** in Hana's settings, and **「通知🌸配置」** in the card center. Both open the same page.

How it is installed changed with it:

- This generation installs as an **app directory** (`%USERPROFILE%\.hanako\apps\notification-hub`) rather than into the plugin directory
- The floor moved from HanaAgent 0.158.0 to **0.978.0**
- The app declares its capabilities in the manifest instead of asking for a blanket of access

## 🔔 More kinds of notification

**The status group was spread out, and a new path came in.**

0.2.1 gave you three things: a conversation ending, a channel message, and a status group holding errors, finished scheduled tasks, and activity changes.

0.3.55 spreads that status group out. A tool error, a failed model call, an unavailable model, and a rate limit now each have their own origin, and errors and failures uniformly appear as the more important kind of notification. Scheduled tasks and activity changes are still there, but each has its own switch rather than sharing one gate.

A new path in also appeared: other apps can hand it a notification to deliver, in ordinary, error, success, and progress flavors, and can withdraw one of theirs that is still on screen.

## 🔊 Sound went from one set to several

**Important notifications have a sound of their own for the first time.**

0.2.1 had one sound theme shared by status and important notifications, with conversation and channel able to differ.

In 0.3.55, conversation, channel, important notifications, and status/fallback each have their own: one of the built-in sounds, silence, or a file of your own (wav, mp3, m4a, aac, wma).

Important notifications have a theme of their own and a sound of their own for the first time; when it is left empty the choice flows back along an inheritance rule — first the important notification's own, then the status/fallback one.

The visual system that colors conversation and channel by agent did not change, and neither did the way particles and the exit are drawn.

## 🏷️ A conversation name now comes only from the host

**The name in the list and the conversation you actually open now agree.**

0.2.1 read the name from a title file in the session directory.

0.3.55 reads it only from the host's session list:

- when the host supplies a title, the name and the session id are stored together
- when the host has none, the list says **「未命名会话」** and the app invents no name of its own

## 🔀 The list learned to merge

**Consecutive replies in the same conversation within 60 seconds become one row.**

This is the most noticeable single change in 0.3.55. Consecutive replies in the same conversation within 60 seconds become one row in the list, with a count of how many were merged.

On the desktop each reply still gets its own popup and its own sound — only the row is shared, and no popup or sound is ever dropped because of it.

The switch is called **「六十秒合并」** and is on by default. After it is turned off, new replies each take a row; rows already merged stay as they are and are not split apart.

The list gained a few more things too:

- the displayed count is yours to set (the file always keeps the most recent **200**)
- a single row's source can be muted in place
- clearing the history renames the file within the same directory

The history itself never changed: at most 200 records.

## 🌙 It learned to be quiet

**It used to be all or nothing — now there are several grades in between.**

In 0.2.1 it either popped up or it did not.

0.3.55 adds a whole set of ways to not be disturbed:

- a **quiet-hours span**, during which nothing pops up while notifications are still written to the list, and which may cross midnight
- the ability to **mute** one conversation or one channel so it neither pops nor plays while the row stays in the list marked「不提醒」
- or simply **「只记录到列表」**, letting the desktop stay entirely silent — but this never falls back to a Windows banner of its own

## 🖱️ How a popup behaves changed

**Clicking just folds it away; it no longer walks you back.**

In 0.2.1, clicking a popup walked you back: it switched to that conversation or opened that channel, and broadcast the event.

0.3.55 no longer does that. Clicking folds the popup away and marks the row **「刚点开」** in the notification page — nothing more. It does not switch back to a conversation, it does not raise or restore Hana's main window, and the page no longer offers a way back to the conversation either.

Three more things changed with it:

- after a timeout on the display confirmation there is no second popup and no second sound
- a popup that is leaving no longer blocks clicks
- the stacking order, bottom to top, is the particles, then popups that are leaving, then popups that are on screen

The appearance, the particles, and the sound timbres are unchanged — only part of the implementation was split apart.

## 🚫 What this generation no longer does

- There is no mode that borrows a native Windows notification banner; only "the app draws its own popup" and "record to the list only" remain
- Clicking a popup or a list row no longer **switches back to a conversation** or raises or restores Hana's main window
- There is no sidebar entry, and there is no end-of-day review
- The extension details page cannot turn **「通知中心」** and **「通知🌸配置」** on or off separately

## 🧩 What moved underneath

Just a few notes to explain the changes above. Recording and popup delivery are now written as two separate parts, and the delivery path changed: a v2 host cannot open TCP, so a pending popup command is first written to a queue in the app's data directory, and the helper reads one, deletes it, then runs it. The appearance, particles, and sound timbres all stayed.
