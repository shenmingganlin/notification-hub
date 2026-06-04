# 🌸 Notification Hub for HanaAgent

<p align="center">
  <b>把 HanaAgent 的通知，从灰色系统弹窗升级成一座桌面视觉小剧场。</b><br />
  Agent 回复、频道消息、任务失败、关键词提醒、通知历史、自定义弹窗物理、粒子退场、视觉组合包、右上角通知中心，一个插件全部接管。
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

> 这是一个通知插件，也是一个桌面特效玩具箱。它把 HanaAgent 里的事件，变成能看见、能点击、能爆开、能飞散、能被记录的桌面信号。

---

## ✨ 这是什么？

**Notification Hub** 是给 [HanaAgent](https://github.com/liliMozi/openhanako) 用的桌面通知中心插件。

它会监听 HanaAgent 的事件，并把它们转换成漂亮、可配置、可点击的通知：

- Agent 回复完成
- 频道收到新消息
- 关键词命中重要提醒
- 后台任务完成
- 错误、失败、状态警报
- 手动测试通知
- 右上角小组件里的通知历史

但它不止是“弹一下”。它还提供自定义 Windows 弹窗、弹簧堆叠、粒子退场、角色配色、视觉组合包、提示音主题、频道聚合、来源染色和本地通知记录。

如果 HanaAgent 是你的 Agent 驾驶舱，那么 Notification Hub 就是那块会发光、会跳动、会提醒你“刚刚发生了什么”的仪表盘。

---

## 🔥 功能爆炸清单

### 🎭 自定义桌面弹窗渲染器

Notification Hub 自带 Windows helper 渲染器，可以用自定义漂亮弹窗接管普通系统通知。

你会得到：

- 右下角悬浮通知卡片
- 点击通知跳转到对应对话或频道
- 多通知堆叠管理
- TCP 快速投递路径
- 文件投递 fallback
- helper 生命周期管理
- 群舞弹簧与独奏轻弹两种运动方式

### 🌈 视觉组合包

一个下拉框，直接切换整套通知人格：

| 组合包 | 气质 |
| --- | --- |
| `magicAir` | 玻璃卡片、气泡粒子、柔和魔法感 |
| `cyberBurst` | 霓虹赛博、像素雨、锐利冲击 |
| `auroraPrism` | 棱镜登场、彩虹配色、轨道衰减 |
| `physicalToys` | 物理玩具、风车粒子、夸张弹性 |
| `sakuraOverdrive` | 樱花暴走、高密度粒子、野性手感 |
| `blackGoldMachine` | 黑金机械、金属齿轮、磁吸爆发 |
| `emberComet` | 全息薄膜、彗星粒子、余烬橙金 |
| `moonlitHolo` | 月光蓝紫、月牙粒子、柔和全息 |

组合包是**模板，不是锁死配置**。你可以先套一个大风格，再继续微调弹窗样式、粒子形状、登场效果、退场轨迹、物理手感和配色。

### 💥 粒子退场与运动轨迹

通知不会只是消失。它会退场。

粒子形状包括：

```text
苔花、樱花、雪花、蝴蝶、气泡、风车、星芒、火花、晶片、叶片、像素块、彗星、金属齿轮、余烬火羽、月牙、光刃
```

自动消失轨迹包括：

```text
飘散、圆形爆发、矩形爆发、X 爆发、漩涡、丝带气流、重力坠落、轨道衰减、气泡上浮、风车阵风、晶裂线、像素雨、磁吸弹射
```

手动关闭还额外支持：

```text
鼠标位置爆发 click-burst
```

所以自动消失和手动点击可以拥有完全不同的物理语言。

### 🧠 智能事件路由

Notification Hub 能理解多类 HanaAgent 事件：

- `message_end`：Agent 回复完成
- `channel_new_message`：频道新消息
- `notification`：接管引擎/原生 notify
- `error`、`cron_job_done`、`activity_update`：状态监控

它还会避开常见通知陷阱：

- 跳过工具调用过程中的 `message_end`
- 跳过 aborted 回复
- 跳过 subagent 内部会话
- 跳过手机桥接内部会话
- 避免 notification 自递归
- 过滤系统发送者

### 🚦 关键词重要提醒

普通消息安静出现，重要消息立刻升格。

默认关键词示例：

```text
紧急, 重要, bug, 报错, 失败, 完成了, error, failed, urgent, important
```

命中关键词后，通知可以自动变成 important，并使用更醒目的声音和视觉样式。

### 🧺 频道聚合摘要

频道刷屏时，桌面不该被弹窗淹没。

Notification Hub 可以在一个时间窗口内聚合普通频道消息，合并成一条摘要通知。重要通知不会被聚合，会立刻弹出。

可配置：

- 是否启用频道聚合
- 聚合时间窗口
- 聚合阈值

### 🪟 右上角通知小组件

插件会贡献一个 Hana widget：**通 / Notifications**。

它提供通知历史面板：

- 对话 / 频道 / 状态通知记录
- 来源染色
- 浅色 / 暗色 / 自动主题
- 宽松大字显示密度
- 清空通知工具
- 列出通知工具

### 🔊 提示音主题

支持多种提示音：

```text
ding, chime, notify, system, alert, alarm, off
```

聊天、频道、重要通知、状态警报都可以分别配置是否播放声音。

---

## 🧩 架构

```text
notification-hub/
├─ manifest.json                    # Hana 插件元数据和设置 schema
├─ index.js                         # 生命周期、EventBus 路由、通知编排
├─ lib/
│  ├─ notification-config.js         # 配置归一化与运行时配置
│  ├─ effect-registry.js             # 视觉组合包、样式、轨迹、粒子、主题注册表
│  ├─ custom-toast.js                # 自定义弹窗投递与 helper manager 客户端
│  ├─ notification-store.js          # 本地通知历史
│  └─ agent-resolver.js              # Agent 身份与主题解析
├─ routes/
│  └─ widget.js                      # 小组件 HTML 路由
├─ tools/
│  ├─ test-notify.js                 # Agent 可调用的测试通知
│  ├─ list-notifications.js          # 读取通知历史
│  └─ clear-notifications.js         # 清空通知历史
├─ helper/
│  ├─ NotificationToastHelper.cs     # Windows 弹窗 helper 源码
│  ├─ NotificationToastHelper.csproj # helper 项目文件
│  └─ notification-toast-helper.exe  # 插件使用的预构建 helper
└─ scripts/
   ├─ check-notification-config.mjs
   ├─ check-notification-types.mjs
   ├─ check-widget-preview.mjs
   └─ check-test-notify.mjs
```

一个关键设计原则：所有视觉能力优先集中在 `lib/effect-registry.js`。新增样式、粒子、轨迹、主题和组合包时，先注册，再接入 renderer。这样可以避免视觉逻辑散落在各个核心流程里，后期不会“改一处动全身”。

---

## 🚀 安装

### 要求

- Windows
- HanaAgent `>= 0.158.0`
- 允许该插件使用 full-access 权限

### 手动安装

下载 Release 里的 `notification-hub-0.1.0.zip`，解压到：

```text
%USERPROFILE%\.hanako\plugins\notification-hub
```

然后在 HanaAgent 插件设置里启用或重载插件。

开发时可以通过 HanaAgent 的插件开发工具安装源码目录。插件 id 是：

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

期望输出：

```text
notification config checks ok
notification type checks ok
widget preview checks ok
test-notify checks ok
channel aggregation smoke ok
status notifications smoke ok
```

---

## 🛠 构建 Windows helper

普通使用可以直接使用仓库里的预构建文件：

```text
helper/notification-toast-helper.exe
```

如果你想自己构建，需要安装 .NET SDK，然后运行：

```bash
cd helper
dotnet publish -c Release -r win-x64 --self-contained false
```

再把产物复制回：

```text
helper/notification-toast-helper.exe
```

---

## ⚙️ 配置亮点

Notification Hub 在 HanaAgent 设置页暴露了大量配置项：

- 通知显示方式：custom / native / off
- 视觉组合包
- 弹窗卡片样式
- 粒子形状
- 粒子数量倍率
- 粒子大小倍率
- 登场效果
- 自动消失轨迹
- 手动关闭轨迹
- 物理手感
- 弹窗运动方式
- 提示音主题
- 频道聚合
- 关键词重要提醒
- 小组件主题
- 小组件显示密度
- 来源染色
- 点击跳转

这个插件的目标是：预设可以一键变好看，细节也能继续被调到疯狂。

---

## 🧪 公共工具

插件贡献了三个 Agent 可调用工具：

| 工具 | 用途 |
| --- | --- |
| `notification-hub_test-notify` | 按当前显示方式发送测试通知 |
| `notification-hub_list-notifications` | 读取最近通知历史 |
| `notification-hub_clear-notifications` | 清空通知历史 |

---

## 🔐 隐私与本地数据

通知历史保存在 HanaAgent 管理的插件数据目录里。

本仓库不需要 API Key、云端凭据或外部账号。

如果你 fork 或重新发布，请不要把这些内容提交到 git：

- 本地通知历史
- smoke 测试数据目录
- helper 备份 exe
- 临时 helper 构建产物
- 个人 HanaAgent 数据目录

仓库里的 `.gitignore` 已经为这些情况做了防护。

---

## 🧭 Roadmap

后续可以继续做：

- 每个视觉组合包的截图 / GIF 展示
- marketplace 元数据
- 更多 helper renderer 主题
- 按 Agent 自动应用视觉组合包
- 视觉预设导入导出
- 更丰富的小组件过滤
- 如果 HanaAgent 暴露稳定跨平台渲染接口，接入跨平台 backend

---

## 🤝 贡献

欢迎 PR，尤其是：

- 新视觉组合包
- 新粒子形状
- 新退场轨迹
- 小组件 UI 改进
- 更安全的生命周期处理
- 配置归一化与通知路由测试

新增视觉能力时，请优先集中到 `lib/effect-registry.js`，并尽量补一个聚焦测试。

---

## 📄 许可证

MIT License.

---

<p align="center">
  <b>Notification Hub 是 HanaAgent 的通知插件，也是一盒桌面视觉烟花。</b>
</p>
