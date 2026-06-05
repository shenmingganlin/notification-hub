# 🌸 Notification Hub for HanaAgent

<p align="center">
  <b>你还在让 Hanako 回复完以后，安安静静地躺在后台吗？</b><br />
  一个让 HanaAgent 的回复、频道消息、任务状态和重要事件主动跳到你桌面上的通知中心。
</p>

<p align="center">
  <img alt="HanaAgent" src="https://img.shields.io/badge/HanaAgent-%E2%89%A5%200.158.0-ff7ab6" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-4f8cff" />
  <img alt="Plugin" src="https://img.shields.io/badge/plugin-full--access-f6c177" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-7bd88f" />
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

---

## 你是否也遇到过这种情况？

你让 Hanako 思考一个问题。  
你切走窗口，喝水、写代码、翻网页、顺手打开十七个标签页。  
等你终于想起来：

> “欸？她是不是该回完了？”

回去一看，Hanako 已经优雅地回复完了。  
只不过她太有礼貌了，完全没有打扰你。

问题是：  
**你真的想让她这么礼貌吗？**

---

你是否也遇到过这种情况？

频道里的朋友们聊得热火朝天，  
Agent 们在角落里交换情报，  
后台任务完成了，  
某个工具报错了，  
一条写着“bug”“失败”“完成了”的重要消息悄悄出现了。

而你，毫无察觉。

你的桌面像一片平静的湖。  
实际后台已经像小动物开会一样热闹。

---

还有通知历史。

你是否曾经看到一个通知闪过去，然后大脑突然掉线：

> “刚刚那个是什么来着？”

系统通知：不知道。  
聊天窗口：你自己翻。  
日志文件：祝你好运。

这显然不太像 2026 年该有的体验。

所以，Notification Hub 出现了。

---

## ✨ 这是什么？

**Notification Hub** 是一个为 [HanaAgent](https://github.com/liliMozi/openhanako) 设计的桌面通知中心插件。

它做的事情很简单：

> 把 HanaAgent 里那些“你最好知道一下”的事情，变成清晰、漂亮、可点击、可追溯的桌面通知。

Hanako 回复完成了？  
它提醒你。

频道里有新消息？  
它提醒你。

后台任务完成或失败了？  
它提醒你。

重要关键词出现了？  
它提醒你。

你刚才没看见？  
它替你记下来。

它有点像 HanaAgent 的桌面前台。  
也有点像一个小小的事件雷达。  
如果你愿意把它调得花一点，它还可以像一只会发光、会冒粒子、会“啪”一下出现的小妖精。

但本质上，它只解决一个问题：

> 不要让重要信息在后台变成失踪人口。

---

## 🔥 它能干什么？

### 🎭 让回复完成不再“静悄悄”

Hanako 回完了，桌面弹一下。

不是那种冷冰冰的系统弹窗，而是可以自定义样式、布局、缩放、声音和动效的通知卡片。

你可以把它调得很安静。  
也可以把它调得像桌面上来了一个小型烟花表演。

你掌控分寸。

### 💬 让频道消息不再靠缘分发现

频道有新消息时，它可以提醒你。

如果频道太热闹，它也不会像机关枪一样把桌面打穿。

Notification Hub 支持频道聚合：

> 人少时逐条提醒，人多时打包摘要。

这叫有礼貌的热闹。

### 🚦 让重要消息自动变显眼

普通消息可以温柔一点。  
重要消息应该拍你一下。

你可以设置关键词，比如：

```text
紧急
重要
bug
报错
失败
完成了
error
failed
urgent
important
```

命中以后，通知会自动升格。

简单说：

> 平时它是前台小管家。  
> 出事时它是警报器。  
> 没事时它不会装警报器。

### 🧺 让通知有地方可查

通知不应该是一闪而过的电子流星。

Notification Hub 提供通知中心小组件：

```text
通 / Notifications
```

你可以查看：

- 对话通知
- 频道通知
- 状态通知
- 错误通知
- 重要提醒

错过了也没关系。  
它帮你收进小篮子里。

### 🌈 让通知变得好看一点

如果只是“能提醒”，那系统通知也能做。  
Notification Hub 的野心稍微大一点：

> 它想让通知看起来像 HanaAgent 世界里自然长出来的东西。

你可以选择视觉组合包：

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

想要玻璃感？可以。  
想要赛博霓虹？可以。  
想要樱花暴走？也可以。  
想要黑金机械小怪物？当然可以。

甚至通知消失时，也不必只是消失。  
它可以飘散、爆开、下坠、上浮、碎裂、磁吸、变成像素雨。

毕竟，如果一个通知已经要打扰你了，  
它至少应该打扰得好看一点。

### 🧩 多种弹窗布局

不同的信息，适合不同的摆法。

支持的 toast layout：

```text
hero
clean
headline
dialogue
timeline
```

默认是 `clean`，清楚、克制、不抢戏。  
如果你想更有存在感，也可以切成别的样子。

### 🎨 通知中心面板主题

右上角通知中心也不是“随便放个列表”。

支持面板主题：

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

`auto` 模式下，面板主题可以跟随视觉组合包自动匹配。  
弹窗和通知中心会看起来像同一个世界里的东西。

### 🔊 让声音也有性格

支持声音主题：

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

也支持自定义声音文件：

```text
wav
mp3
m4a
aac
wma
```

你可以让聊天消息轻轻响一下，  
让频道消息换一种声音，  
让错误通知更明显一点，  
或者干脆给它塞一个你自己的音效。

是的，通知也可以有自己的 BGM。  
虽然不建议太离谱，但技术上它允许你离谱。

---

## 一句话总结

Notification Hub 是 HanaAgent 的通知小管家。

它负责在这些事情发生时戳你一下：

- Hanako 回复完成
- 频道出现新消息
- 后台任务结束
- 工具或流程失败
- 重要关键词命中
- 系统状态发生变化

并且它不仅会戳你，还会：

- 戳得好看
- 戳得有声音
- 戳得有层次
- 戳完还帮你记下来

---

## 🧠 适合谁？

如果你只是偶尔打开 HanaAgent 聊两句，  
它可能有点豪华。

但如果你经常：

- 让 Hanako 在后台思考
- 使用频道和其他 Agent 协作
- 跑定时任务或后台任务
- 不想错过错误和完成状态
- 喜欢桌面 UI 有一点审美
- 讨厌“刚刚那个通知是什么来着”的失忆感

那它大概会很快从“插件”变成“基础设施”。

---

## 🧩 架构概览

```text
notification-hub/
├─ manifest.json                    # Hana 插件元数据和设置 schema
├─ index.js                         # 生命周期、EventBus 路由、通知编排
├─ lib/
│  ├─ notification-config.js         # 配置归一化与运行时配置
│  ├─ effect-registry.js             # 视觉组合包、样式、轨迹、粒子、主题注册表
│  ├─ custom-toast.js                # 自定义弹窗投递与 helper manager 客户端
│  ├─ notification-store.js          # 本地通知历史
│  ├─ agent-resolver.js              # Agent 身份与主题解析
│  ├─ delivery/
│  │  └─ toast-decoration.js         # 通知内容装饰
│  ├─ policy/
│  │  └─ notification-policy.js      # 通知策略
│  └─ sound/
│     ├─ sound-decision.js           # 声音选择决策
│     ├─ sound-registry.js           # 声音主题注册
│     ├─ sound-resolver.js           # 声音路径解析
│     └─ windows-sound-picker.js     # Windows 声音选择辅助
├─ routes/
│  └─ widget.js                      # 小组件 HTML 路由
├─ tools/
│  ├─ test-notify.js                 # Agent 可调用的测试通知
│  ├─ list-notifications.js          # 读取通知历史
│  └─ clear-notifications.js         # 清空通知历史
├─ helper/
│  ├─ NotificationToastHelper.cs     # Windows 弹窗 helper 源码
│  ├─ NotificationToastHelper.csproj # helper 项目文件
│  └─ notification-toast-helper.exe  # 预构建 helper
└─ scripts/
   ├─ check-notification-config.mjs
   ├─ check-notification-types.mjs
   ├─ check-widget-preview.mjs
   ├─ check-test-notify.mjs
   ├─ check-sound-system.mjs
   └─ check-runtime-regressions.mjs
```

核心设计原则：

> 视觉能力优先注册到 `lib/effect-registry.js`，再由配置系统和 helper 渲染层消费。

这样可以避免视觉逻辑散落在各个流程里，后续新增样式、粒子、主题和组合包时更容易维护。

---

## 🚀 安装

### 要求

- Windows
- HanaAgent `>= 0.158.0`
- 允许该插件使用 full-access 权限

### 手动安装

从 Release 页面下载最新版：

```text
notification-hub-0.2.0.zip
```

解压到：

```text
%USERPROFILE%\.hanako\plugins\notification-hub
```

然后在 HanaAgent 插件设置中启用或重载插件。

### 开发模式安装

如果你正在开发或调试插件，可以通过 HanaAgent 的插件开发工具安装源码目录。

插件 id：

```text
notification-hub
```

---

## 🧪 测试

运行语法检查：

```bash
npm run check
```

运行回归测试：

```bash
npm test
```

构建 Windows helper：

```bash
dotnet build helper/NotificationToastHelper.csproj -c Release
```

生成 helper 发布产物：

```bash
dotnet publish helper/NotificationToastHelper.csproj -c Release -o helper/publish
```

当前 release 候选验证项：

```text
npm run check
npm test
dotnet build helper/NotificationToastHelper.csproj -c Release
dotnet publish helper/NotificationToastHelper.csproj -c Release -o helper/publish
```

---

## ⚙️ 配置能力

Notification Hub 支持很多旋钮，包括：

- 是否启用通知
- 是否启用自定义 toast
- 通知位置
- toast 布局
- toast 缩放
- toast X/Y 偏移
- toast 卡片样式
- 视觉组合包
- 粒子形状、数量和尺寸
- 自动退场轨迹
- 手动点击退场轨迹
- 物理预设
- 面板主题
- 来源染色
- 频道聚合
- 重要关键词
- 聊天提示音
- 频道提示音
- 状态/重要通知提示音
- 自定义声音路径

如果你只想简单使用，选择一个视觉组合包就够了。  
如果你想细调，它也给你足够多的旋钮。

---

## 📦 Release 包说明

源码仓库尽量保持干净，只保留源码、配置、脚本和必要说明。

Release zip 会额外包含 helper 运行所需文件：

```text
helper/notification-toast-helper.exe
helper/notification-toast-helper.dll
helper/notification-toast-helper.deps.json
helper/notification-toast-helper.runtimeconfig.json
```

这样用户手动安装后可以直接使用自定义桌面弹窗。

---

## 📝 Changelog

详见：

```text
CHANGELOG.md
```

---

## 🛣️ Roadmap

后续可能继续改进：

- C# helper 拆分为更清晰的模块
- JS 与 C# 之间增加 payload schema 校验
- 更多视觉组合包
- 更多面板过滤能力
- 更细的 per-agent 通知策略
- 视觉预设导入/导出
- 更完整的截图/GIF 展示
- 如果 HanaAgent 提供稳定跨平台通知接口，接入跨平台 backend

---

## 🤝 Contributing

欢迎提交 issue、建议和 PR。

适合贡献的方向：

- 新 toast 布局
- 新粒子形状
- 新退场轨迹
- 新视觉组合包
- Widget UI 优化
- 配置归一化测试
- 通知路由测试
- 文档和截图补充

如果你想改视觉系统，建议先从：

```text
lib/effect-registry.js
```

开始看。

---

## 📄 License

MIT
