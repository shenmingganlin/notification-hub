# Notification Hub 0.3.55

## Card and settings page

The notification center now fills the host's card frame as a single page, without a second frame inside it. The notification list, settings, visual options, and sound controls all share this page, and the card cover uses `ui/face-4.png`. It is accessible through “通知中心” in Hana settings and “通知🌸配置” in the card center. List entries no longer offer a way to switch back to a conversation. The settings page adds “六十秒合并” (Sixty-second merging), allowing consecutive replies to share a row when desired.

## Internals

The popup helper has been separated by responsibility, preserving the existing appearance, particle effects, and sound timbres. A confirmation timeout no longer produces a second popup or a second sound. Clearing history uses a rename within the same directory, without `fsync`. Popups that are exiting no longer intercept clicks. From bottom to top, the stacking order is particles, exiting popups, then visible popups. Clicking a popup no longer activates Hana's main window. Conversation names now come from the host's session list. Sixty-second merging applies only to the notification list; each reply's desktop popup and sound are still handled separately under the existing settings.
