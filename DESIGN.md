---
name: sharge-cli-site-design
description: "Design, build, or substantially revise the official sharge CLI landing page and documentation site. Use this authority for composition, Sharge visual language, responsive behavior, light and dark themes, interaction, accessibility, and visual review."
---

# 像 Sharge 一样设计 sharge CLI 网站

把落地页与文档站视为 Sharge Open Platform 的官方开发者品牌表面。它首先帮助人理解、信任并把 `sharge` 交给 Agent，其次才展示视觉风格。

页面应当安静、直接、可信、技术上准确，并具有 Sharge Web 的轻盈质感。通过清晰的信息层级、精确文案、可验证执行路径和克制细节建立信任。不要依靠夸张口号、伪终端、无意义动效、装饰性 AI 图像或大量卡片制造“AI 感”。

## 产品与品牌语境

`sharge` 是 Sharge Open Platform 的官方 Agent-first CLI。它同时面对两类读者：

- 想让 Agent 安装并使用 Sharge 能力的人；
- 想直接查询 CLI 命令、契约和安全行为的人。

首页的核心任务是把一句 Prompt 交给 Agent。文档站的核心任务是降低查找和验证成本。两者必须共用品牌、导航、主题、排版和交互语言，但可以使用不同的信息密度。

不要把站点设计成：

- 普通 npm 包模板；
- 通用 SaaS 首页；
- Web App 仪表盘复制品；
- 终端主题作品集；
- 只有黑白配色的 Vercel 仿站；
- 带有大量紫色渐变的通用 AI 产品页。

目标是 Sharge 判断力，而不是复制任何参考站点的装饰。

## 冲突时的优先级

需求冲突时按以下顺序保护：

1. 保留 CLI 已实现的事实、命令、安全语义、凭证要求和用户确认过的原文。
2. 保留 [`specs/sharge-cli-website.md`](./specs/sharge-cli-website.md) 的路由、内容边界、GitHub Pages 约束和完成标准。
3. 让“复制 Prompt 给 Agent”在第一屏立即可理解和操作。
4. 让登录中的人类授权边界与验证结果清晰可见。
5. 通过 Logo、排版、黑白灰层级、柔和背景、玻璃表面与克制青柠状态色建立 Sharge 品牌连续性。
6. 保证文档阅读、搜索、键盘与移动端体验。
7. 最后才加入非必要的动画、阴影和视觉细节。

不知道的事实应省略或标明，不得根据视觉需要发明命令、scope、能力、版本、性能、用户数量或安全承诺。

## 与项目集成

保持 Astro、Starlight、Tailwind CSS v4、静态输出和 `website/` 边界。不要为了视觉实现替换框架、引入 React 运行时或建立 Web App 组件依赖。

自然归属：

- 公共语义 token：`website/src/styles/tokens.css`；
- 全局排版、背景与基础元素：`website/src/styles/global.css`；
- 落地页特有组合：落地页组件自己的样式或 Tailwind utilities；
- Starlight 覆盖：单一文档主题样式入口；
- 品牌 Logo 和产品图标：复制经确认的静态 SVG 资产并记录来源；
- 交互：Astro 组件中的少量原生 TypeScript。

不要：

- 在每个组件重新声明颜色或阴影；
- 用任意 hex 绕过语义 token；
- 复制 `web-app` 的整个 Tailwind 主题；
- 从本地绝对路径加载资产；
- 运行时请求 Web App、npm registry 或设计 token；
- 引入第三方字体、图标脚本、分析、动画库或 UI kit，除非另有明确批准。

## 分四个阶段工作

### 1. 明确读者任务

设计前先确认：

- 当前页面是谁打开的；
- 他希望理解、复制、执行或查找什么；
- 哪一个事实或操作必须成为第一视觉锚点；
- 哪个安全边界会改变他的行为；
- 什么信息需要保留供查证，但不应主导第一屏。

首页的答案固定为：Prompt 是第一操作，终端执行路径是解释，特性与能力是证明。

文档页的答案由当前主题决定。标题、首段、正文、代码和本页目录应让读者无需重新理解整个产品即可完成当前任务。

### 2. 选择构图

先决定几何关系，再选择组件。

首页第一屏需要同时呈现：

- 官方身份与产品定位；
- 可复制的 Agent Prompt；
- 安装与授权的执行反馈。

桌面默认采用双锚点构图：左侧标题与安装卡，右侧终端演示。Prompt 的操作权重高于终端；终端不能比安装卡更大、更亮或更早进入阅读顺序。

文档默认采用三栏：导航、正文、本页目录。正文永远是主列。侧栏和目录提供位置感，不与标题和代码争夺注意力。

每个后续首页 section 只回答一个新问题：

1. 为什么适合 Agent；
2. 能访问什么；
3. 如何安全执行；
4. 下一步做什么。

不要用多个 section 反复解释“Agent-first”。

### 3. 使用统一视觉系统

颜色、排版、间距、圆角、边界、阴影、代码与状态全部来自本文件。页面特有样式负责布局，不创造平行设计系统。

### 4. 渲染并修正

每次显著修改后渲染实际页面。先看第一屏和信息层级，再看颜色和细节。必须检查桌面/手机、浅色/深色、键盘和 reduced motion。

修正最高影响的系统问题，然后重新渲染。不要用更多卡片、边框或阴影补偿弱层级。

## Sharge 视觉系统

### 品牌外壳

每个页面使用同一个品牌结果：

- Header 左侧使用现有 SHARGE Logo；
- `CLI` 是相邻但独立的文字标记，不改写 Logo SVG；
- Footer 使用同一 Logo 或经确认的紧凑品牌标记；
- Logo 使用原始比例，不拉伸、不描边、不添加 glow；
- Header 中 `文档`、`GitHub` 和主题切换保持可发现；
- 文档页可以增加 `返回首页` 与搜索，但不要形成另一套 Header。

首版没有语言切换器。不要显示不可用的 English 入口。

Header 可以是轻微半透明的 sticky surface。它必须有不支持 `backdrop-filter` 时的实色 fallback。边界优先用空间；只有 sticky 内容需要与页面分离时才使用一条细边框。

### 网格与对齐

使用共享内容边界：

```css
--sg-layout-max: 80rem;       /* 1280px */
--sg-gutter-mobile: 1rem;    /* 16px */
--sg-gutter-tablet: 1.5rem;  /* 24px */
--sg-gutter-desktop: 2rem;   /* 32px */
--sg-grid-gap: 1.5rem;       /* 24px */
```

- `>= 1280px`：12 列；
- `>= 768px` 且 `< 1280px`：6 列；
- `< 768px`：4 列。

首页 Hero 桌面通常是 6/6 或 7/5。安装卡内容多时给左侧更多宽度。不要为了对称压缩 Prompt。

文档桌面布局：

```text
导航 248–272px | 正文 minmax(0, 760px) | 本页目录 176–208px
```

正文段落的理想行长为 28–42 个中文字符。代码块可以使用正文全宽。所有 grid 和 flex 子项设置 `min-width: 0`，先重排再考虑局部横向滚动。

每个对象必须对齐共享边缘、基线、网格线或明确的光学中心。三个真正同级的特性可以等宽；不等价的内容不要强行塞进相同卡片。

### 排版与节奏

不加载外部字体。使用系统字体：

```css
--sg-font-sans:
  ui-sans-serif,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  sans-serif;

--sg-font-mono:
  ui-monospace,
  SFMono-Regular,
  Menlo,
  Monaco,
  Consolas,
  "Liberation Mono",
  monospace;
```

只将命令、代码、路径、URL、原始 token、版本号和短操作标识设置为 Mono。不要把整个 Prompt、按钮或说明段落设为 Mono；Prompt 中的 URL 可以单独使用 Mono。

类型角色：

| 角色 | 桌面 | 手机 | 行高 | 字重 |
| --- | --- | --- | --- | --- |
| Display | 56px | 40px | 1.08 | 600 |
| Page title | 40px | 32px | 1.15 | 600 |
| Section | 32px | 28px | 1.2 | 600 |
| Subsection | 24px | 22px | 1.3 | 600 |
| Lede | 18px | 17px | 1.65 | 400 |
| Body | 16px | 16px | 1.75 | 400 |
| Compact | 14px | 14px | 1.6 | 400/500 |
| Metadata | 12px | 12px | 1.5 | 500 |
| Code | 14px | 13px | 1.65 | 400 |

使用 `clamp()` 平滑过渡 Display 与 Page title。中文不使用夸张 tracking。全大写英文 eyebrow 不是默认做法；若需要表明官方身份，优先使用 sentence case 的短标签，例如 `Sharge Open Platform 官方 CLI`。

垂直节奏表达关系：

- 标题到首段：近；
- 首段到主操作：中；
- 一个内容组到新 section：远；
- 说明到它限定的代码或控件：近；
- 卡片内部同级项目：一致。

不要对所有子元素使用同一个 gap。不要通过缩小灰色文字解决内容过多，先改写、分组或重排。

### 颜色语义

浅色主题继承 Sharge Web 的核心 token：

```css
:root {
  color-scheme: light;

  --sg-primary: #111111;
  --sg-primary-end: #3a3a3a;
  --sg-primary-foreground: #ffffff;
  --sg-primary-soft: rgb(17 17 17 / 8%);
  --sg-primary-softer: rgb(17 17 17 / 5%);
  --sg-primary-border: rgb(17 17 17 / 14%);
  --sg-primary-shadow: rgb(17 17 17 / 20%);

  --sg-bg: #f2f2f2;
  --sg-bg-secondary: #e5e5e5;
  --sg-surface: rgb(255 255 255 / 86%);
  --sg-surface-strong: #ffffff;
  --sg-surface-hover: rgb(17 17 17 / 6%);
  --sg-border: rgb(17 17 17 / 10%);

  --sg-text: #252525;
  --sg-text-secondary: rgb(37 37 37 / 56%);
  --sg-text-muted: rgb(37 37 37 / 36%);

  --sg-success: #98e21a;
  --sg-warning: #d97706;
  --sg-error: #dc2626;
  --sg-focus: #111111;

  --sg-terminal: #111111;
  --sg-terminal-surface: #1a1a1a;
  --sg-terminal-text: #f5f5f5;
  --sg-terminal-muted: rgb(245 245 245 / 58%);
}
```

深色主题使用同一语义，不创建霓虹系统：

```css
[data-theme='dark'] {
  color-scheme: dark;

  --sg-primary: oklch(0.922 0 0);
  --sg-primary-end: oklch(0.78 0 0);
  --sg-primary-foreground: oklch(0.205 0 0);
  --sg-primary-soft: oklch(1 0 0 / 8%);
  --sg-primary-softer: oklch(1 0 0 / 5%);
  --sg-primary-border: oklch(1 0 0 / 14%);
  --sg-primary-shadow: oklch(0 0 0 / 36%);

  --sg-bg: oklch(0.145 0 0);
  --sg-bg-secondary: oklch(0.18 0 0);
  --sg-surface: oklch(0.205 0 0 / 86%);
  --sg-surface-strong: oklch(0.205 0 0);
  --sg-surface-hover: oklch(1 0 0 / 7%);
  --sg-border: oklch(1 0 0 / 10%);

  --sg-text: oklch(0.985 0 0);
  --sg-text-secondary: oklch(0.708 0 0);
  --sg-text-muted: oklch(0.556 0 0);

  --sg-success: #98e21a;
  --sg-warning: #f59e0b;
  --sg-error: #f87171;
  --sg-focus: oklch(0.922 0 0);

  --sg-terminal: #090909;
  --sg-terminal-surface: #111111;
  --sg-terminal-text: #f5f5f5;
  --sg-terminal-muted: rgb(245 245 245 / 58%);
}
```

颜色规则：

- 青柠绿只表示成功、已连接、已完成或健康状态；
- 状态必须同时有图标、形状或文字，不只依赖颜色；
- 主操作使用高对比黑/白，不使用青柠绿大按钮；
- 不引入紫色作为站点品牌色；
- Warning 与 Error 只在真实状态中出现，不用于装饰；
- 正文链接通过颜色、下划线或清晰状态与文本区分，并满足 AA。

### 背景、表面与边界

页面只有一个基础背景。浅色允许使用 Sharge Web 的柔和应用渐变：

```css
background-image: linear-gradient(
  145deg,
  #ffffff 0%,
  #f2f2f2 48%,
  #e8e8e8 100%
);
```

深色使用低对比中性渐变，不使用彩色 glow：

```css
background-image: linear-gradient(
  145deg,
  oklch(0.18 0 0) 0%,
  oklch(0.145 0 0) 52%,
  oklch(0.12 0 0) 100%
);
```

玻璃效果属于 Sharge 品牌，但必须有理由：

- Hero 安装卡可以使用玻璃，强调它是主交互；
- sticky Header 可以轻微透明；
- 终端使用实色高对比表面，不套第二层玻璃；
- 文档正文保持近乎连续画布，不把每个 section 包成卡片；
- 侧栏可以是安静的透明区域，不需要浮空阴影；
- 玻璃内不要嵌套多层玻璃卡。

推荐玻璃：

```css
background: var(--sg-surface);
border: 1px solid var(--sg-border);
backdrop-filter: blur(12px);
```

必须同时提供不透明 fallback。不要使用纹理、噪点、网格背景、彩虹渐变、玻璃球、发光轨道或大面积装饰 blob。

边界首先依赖空间、排版和密度变化。边框只表达：

- 可交互控件；
- 当前选择；
- 代码与正文的材质差异；
- 真实内容分组；
- sticky 区域与滚动内容的分离。

### 间距、圆角与阴影

间距使用 4px 基础步进：

```css
--sg-space-1: 0.25rem;
--sg-space-2: 0.5rem;
--sg-space-3: 0.75rem;
--sg-space-4: 1rem;
--sg-space-6: 1.5rem;
--sg-space-8: 2rem;
--sg-space-12: 3rem;
--sg-space-16: 4rem;
--sg-space-24: 6rem;
--sg-space-32: 8rem;
```

圆角：

```css
--sg-radius-control: 0.625rem; /* 10px */
--sg-radius-code: 1rem;       /* 16px */
--sg-radius-card: 1.25rem;    /* 20px */
--sg-radius-hero: 1.875rem;   /* 30px */
--sg-radius-pill: 999px;
```

普通按钮、搜索框和 Tab 不得都变成 full pill。`--sg-radius-pill` 只用于主题切换、状态点、紧凑标签或确实需要胶囊命中的控件。

阴影：

```css
--sg-shadow-control: 0 1px 2px rgb(17 17 17 / 6%);
--sg-shadow-card: 0 18px 44px rgb(17 17 17 / 10%);
--sg-shadow-focal: 0 30px 90px rgb(17 17 17 / 12%);
```

一个阅读时刻最多有一个 focal shadow。文档代码块不使用浮空阴影。深色主题降低亮边和大面积阴影，依靠表面与边框区分。

### 安装卡与 Prompt

Prompt 是首页最重要的产品对象，不是普通代码示例。

安装卡规则：

- 默认显示 `交给 Agent`；
- `手动安装` 是同级替代路径；
- Tab 使用一个共享容器和明确选中状态；
- Prompt 保持自然中文排版，URL、`README`、`sharge CLI`、`Skills` 可以使用 Mono 或略高对比；
- Prompt 文本可选择，即使 Clipboard API 失败也可手动复制；
- 复制按钮占据清晰宽度，但不挤压 Prompt；
- 按钮状态为 `复制 Prompt` → `已复制`，图标与文字同时变化；
- 卡片内只保留当前任务需要的链接：查看文档、GitHub。

不要：

- 把 Prompt 放进模拟聊天气泡；
- 加入机器人头像、闪光 icon 或 AI 渐变；
- 在 Prompt 中插入不可见追踪参数；
- 用逐字打字动画展示长 Prompt；
- 同时放三个以上主要按钮。

### 终端

终端是执行路径的解释，不是假装运行真实命令。

- 使用 `--sg-terminal*` token；
- 窗口标题简短，例如 `Agent setup`；
- 行内容来自 [`specs/sharge-cli-website.md`](./specs/sharge-cli-website.md)，不展示真实凭证和个人信息；
- 成功标记可以使用 `--sg-success`，普通输出保持中性；
- 不使用五颜六色的 shell 语法；
- 不显示无意义的三色窗口按钮，除非整体窗口语义需要；
- 不加入闪烁光标或无限加载。

动效按“行状态更新”表达，不模拟逐字符输入。建议每行使用 160–240ms opacity/translate 过渡，总时长不超过 3 秒。动画只自动播放一次，并可重播。

### 特性与能力

三个核心特性是真正同级，可以一行三列。每项结构一致：

1. 简洁图标；
2. 明确标题；
3. 一段有事实支持的说明。

四类能力可以使用 2 × 2 或横向序列，根据内容密度决定。不要使用巨大的产品 icon、彩色图标底板或假截图。能力文案必须与当前 CLI help 一致。

安全工作流是一个有方向的序列：发现命令 → dry run → 人类确认 → 执行 → 恢复。使用连接和顺序表达依赖，而不是五张彼此孤立的卡。

### 文档布局

文档页优先级：

1. 当前标题与首段；
2. 正文、命令和注意事项；
3. 左侧位置导航；
4. 本页目录；
5. 版本、编辑和贡献入口。

侧栏：

- 分组标题比正文链接更安静；
- 当前项使用高对比表面与非颜色标记；
- 不为每个项添加 icon；
- 同一层级保持相同缩进、字号和命中高度；
- 长标题允许换行，不截成无法理解的省略号。

正文：

- 一个描述性 `h1`；
- 标题层级不跳级；
- 提示、警告和危险使用语义 aside；
- 普通段落不放进卡片；
- 表格用于精确查询，窄屏优先重组；无法重组时局部滚动；
- 页面底部提供编辑链接与前后页导航。

本页目录：

- 只显示对当前扫描有帮助的层级；
- 当前 section 同时使用位置指示和文本对比；
- 在正文空间不足时移入移动端菜单，不压缩正文。

### 搜索

搜索是文档工具，不是品牌展示。

- 桌面 Header 中提供明确搜索框；
- 显示 `⌘ K` / `Ctrl K` 快捷键提示，但不要让提示盖过输入标签；
- 结果显示标题、所属分组与短摘要；
- 键盘可以打开、移动、选择和关闭；
- 无结果状态给出修改关键词和进入命令概览的下一步；
- 不加入“AI 搜索”占位能力。

### 代码与命令

代码块使用接近终端的实色表面，但文档中所有代码块不需要窗口外壳。

- 复制按钮在右上角，命中区域至少 40 × 40px；
- 长命令保持可横向滚动，不按字符断行；
- Shell 多行示例保留换行和续行符；
- 代码正文至少 13px，推荐 14px；
- Inline code 与正文有清晰但克制的表面区别；
- 复制反馈不改变代码块尺寸；
- 深浅主题的代码都保持 AA 对比度。

不要使用装饰性语法彩虹。颜色只帮助识别语法，不改变阅读层级。

### 按钮与控件

主要按钮：高对比实色，文字明确描述动作。

次要按钮：中性表面或 outline。
Ghost：只用于低风险、低优先级导航动作。

状态必须完整：default、hover、active、focus-visible、disabled、success、error。不要只设计 hover。

所有可交互元素：

- 桌面最小命中高度 36px；
- 移动端最小命中高度 44px；
- 使用原生 button、a、input；
- 有可见 focus ring；
- disabled 不仅降低 opacity，还要保持标签可读；
- 外部链接有可访问名称，必要时说明会离开站点。

### 媒体与图标

优先使用：

1. 已确认的 Sharge Logo 和产品 SVG；
2. 项目已采用的统一线性图标；
3. 语义清楚的文本标签。

图标帮助识别操作或产品域，不用于填空。统一 stroke、尺寸和视觉重量。不要混用 filled、outline、emoji 和 3D 图标。

视觉稿只作为构图参考，不作为生产图像内容。页面不嵌入 ImageGen UI 截图，不展示伪造产品状态。

### 动效与反馈

默认安静。允许的动效：

- Tab 内容切换；
- 复制成功反馈；
- 主题切换；
- 移动导航打开/关闭；
- 终端行状态演示；
- 焦点、hover 与 active 的短过渡。

建议时长：

- 微交互：120–180ms；
- 面板与 Tab：180–240ms；
- 移动抽屉：200–280ms；
- 终端完整演示：不超过 3 秒。

使用 opacity、transform 和颜色，避免动画 height 导致页面跳动。不要使用滚动视差、marquee、bounce、无限 pulse、整页 reveal、背景漂浮、声音或庆祝动画。

`prefers-reduced-motion: reduce` 下取消非必要位移和顺序播放，内容立即完整可见。

## 响应式行为

### 桌面

- Header 一行；
- Hero 双列；
- 三个特性同排；
- 文档三栏；
- 本页目录 sticky，但不超过视口高度。

### 平板

- Hero 根据 Prompt 实际宽度决定 6/6 或堆叠；
- 终端不得压缩到命令难读；
- 文档右侧目录移入顶部或浮层；
- 左侧导航可以保留紧凑宽度或进入抽屉。

### 手机

- Header 保留品牌、文档/GitHub 可达性和主题切换；
- Hero 顺序：标题 → 说明 → 安装卡 → 终端；
- Tab 始终完整显示两个标签；
- Prompt 不做固定高度截断；
- 主复制按钮全宽；
- 特性和能力单列；
- 文档侧栏使用带标题与关闭按钮的抽屉；
- 正文不被目录挤压；
- 代码块局部横向滚动。

不要通过隐藏内容、缩小到 12px 以下、字符级断行或全局 `overflow-x: hidden` 伪造响应式完成度。

## 无障碍

- 使用 header、nav、main、aside、footer 等 landmarks；
- 提供跳到正文链接；
- 每页只有一个描述性 `h1`；
- 视觉顺序与 DOM 阅读顺序一致；
- Tab 使用正确的 tablist/tab/tabpanel 关系；
- 复制状态通过 `aria-live` 简短播报；
- 终端演示提供等价静态文本，不逐行刷屏播报；
- 主题切换有明确名称和当前状态；
- 对话框和抽屉管理焦点、Escape 与返回焦点；
- 所有文本与交互状态达到 WCAG AA；
- 不依赖颜色表达成功、当前项、错误或焦点；
- 尊重浏览器缩放、系统字体和 reduced motion。

## 检查与修正

按以下顺序私下审查实际渲染：

1. **第一眼：** 是否立即知道这是官方 sharge CLI，是否看到 Prompt 是主操作？
2. **构图：** Prompt 与终端是否形成明确主次？每个后续 section 是否回答新问题？
3. **文案：** 命令、Prompt、产品能力和安全语义是否来自事实源？
4. **排版：** 中文行长、换行、层级、基线和节奏是否稳定？
5. **表面：** 是否有可以删除的玻璃、卡片、边框或阴影？
6. **状态：** hover、focus、复制、Tab、主题、搜索、抽屉和错误是否完整？
7. **主题与重排：** 四种基线截图是否保持相同层级并无溢出？
8. **信任与访问：** 浏览器授权边界、凭证安全、语义与键盘是否清楚？

先修复影响全局的缺陷，例如 token、内容宽度、标题尺度、侧栏密度或焦点样式。不要先修一个孤立 icon 的 2px 偏差。

## 拒绝生成式设计惯性

不要交付以下默认模式：

- 紫色、蓝紫或彩虹 AI 渐变；
- 大量 glow、blob、网格背景和噪点纹理；
- 居中 Hero 加两个 CTA 后机械排列卡片；
- 每个 section 都是相同圆角矩形；
- 卡片嵌套卡片；
- 每个标题前都有全大写 eyebrow；
- 每个特性都有彩色 icon tile；
- 伪造 Agent 对话、伪造产品截图或假数据；
- 逐字终端打字和无限闪烁光标；
- 重复解释 Agent-first 的摘要、优势、原因和结论；
- 使用很小的灰字掩盖内容过多；
- 文档正文漂浮在宽阔页面中央，左右留下没有任务的空白；
- 深色主题直接反色或变成霓虹终端；
- Logo 被重新绘制、加发光或塞入彩色方块；
- 把设计过程、生成过程或自我评价写进用户页面。

克制不是把一切做成白底黑字。Sharge 的辨识度来自柔和空间、半透明表面、高对比操作、精确中文排版和少量状态色；只有在这些元素支持用户任务时才使用。

## 公共设计 token API

实现只能消费以下 token 家族；新增 token 必须先更新本文件：

- 品牌与动作：`--sg-primary*`；
- 背景与表面：`--sg-bg*`、`--sg-surface*`；
- 文本：`--sg-text*`；
- 边界与焦点：`--sg-border`、`--sg-focus`；
- 状态：`--sg-success`、`--sg-warning`、`--sg-error`；
- 终端：`--sg-terminal*`；
- 布局：`--sg-layout-*`、`--sg-gutter-*`、`--sg-grid-gap`；
- 间距：`--sg-space-*`；
- 圆角：`--sg-radius-*`；
- 阴影：`--sg-shadow-*`；
- 字体：`--sg-font-*`。

组件不得重新声明 `--sg-*` 的不同值。页面特有变量使用描述性局部前缀，例如 `--landing-*` 或 `--docs-*`，并且不能替代公共颜色、字体、圆角和状态 token。

最终目标不是“像一个文档模板”，而是让人用最少步骤理解并安全地把 Sharge 交给 Agent。
