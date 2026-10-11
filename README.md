# Notification Hub

English · [简体中文](README.zh-CN.md)

## Why notifications appear

Leaving a conversation does not bring its activity to a close. Replies finish, channels receive messages, tasks change state, and important events may occur while your attention is elsewhere.

Notification Hub gives these events a place on the desktop and a record in HanaAgent's notification center. You can notice them as they happen, or find them later if the moment passes. Its purpose is to inform and preserve a record, not to bring Hana to the foreground.

## What is implemented

- **Desktop notifications.** Custom desktop popups replace native Windows notification banners. They cover completed replies, channel messages, and status events such as tasks and errors.
- **Channel aggregation.** With aggregation enabled, busy periods produce a summary, while smaller numbers of messages are delivered individually.
- **Important notifications.** Keywords can promote a notification's importance. Important conversation and channel notifications use the sound selected for important notifications.
- **Sound options.** Notification sounds can be selected, muted, or replaced with a custom sound.
- **Notification history.** Records can be viewed and cleared, with up to 200 retained.
- **Visual settings.** Visual packs, popup layouts, panel themes, entrance effects, particles, and exit effects remain available.
- **Conversation names.** Names come only from the host's session list. Without a host-provided title, the conversation name is shown as “未命名会话” (Untitled conversation); the app does not invent a name. When the host session has a title, its session id is also recorded.
- **Sixty-second merging.** Consecutive replies from the same conversation within 60 seconds share one notification-list row, with a count of the merged replies. Each reply still has its own popup and sound, subject to the notification and sound settings. “六十秒合并” (Sixty-second merging) is enabled by default. Turning it off gives new replies separate rows; existing merged records are not split apart.

There are exactly two entry points: “通知中心” in Hana settings, and “通知🌸配置” in the card center.

## What this version does not provide

These are the boundaries of this version, not promises for a future release.

- Clicking a popup or a list entry does not switch to a conversation, bring Hana to the foreground, or restore its main window.
- There is no sidebar entry point.
- There is no end-of-day review.
- The host's extension details page cannot enable or disable the two entry points individually.
- A session without a host-provided title may not have its session id recorded.

## Installation

The current version is **0.3.55**, for Windows, and requires **HanaAgent >= 0.978.0**. The app id is `notification-hub`. Place the complete app directory at:

```text
%USERPROFILE%\.hanako\apps\notification-hub
```

Use the `apps` directory shown above, not the `plugins` directory. The app uses the capabilities declared in its manifest. To move to another machine, copy the entire `notification-hub` directory to the same location on that machine, then open it through either entry point described above.

## Marketplace

🌸HanaAgent（兰）插件市场现已在软件中开放上线！
☀️自制插件、配方的群友可以提交PR至此仓库：
https://github.com/liliMozi/hana-marketplace
💡如果不知道如何提交的可以让小花协助提交
