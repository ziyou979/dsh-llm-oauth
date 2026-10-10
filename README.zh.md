# dsh-llm-oauth

[English](README.md) | 中文

DeepSeek Harness 的**独立 OAuth / 订阅套餐** LLM 插件。用 `dsh plugin add` 装进自己的 profile，即可登录并使用订阅模型。这是独立仓库，**不改** DeepSeek Harness 本体。

![设置 → OAuth / 订阅](docs/oauth-subscriptions.png)

官方 `dsh-llm-pi-ai` 只走 API Key，没有 OAuth 登录/刷新。本插件复用同一份 catalog 包 [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)，并把 `CredentialStore` 接进去，请求时会自动刷新订阅 token。

仓库形态对齐官方插件文档——[第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)、[发布 / 安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)：

- `package.json` → `dsh.bundle.patch` + 可选 `dsh.client`（Web 设置页）
- `cordis.patch.yml` 插入一行插件
- `prepare` 在 git 安装时把 `src/` 打成 `lib/`（含 `lib/client.js`）
- 函数形态：导出 `name`、`inject`、`Config`、`apply`，**无 `export default`**

## 支持的订阅

| 你想用的订阅 | provider id | 说明 |
|---|---|---|
| Grok（SuperGrok / X Premium） | `xai` | 模型 id 来自已安装的 pi-ai catalog。 |
| GitHub Copilot | `github-copilot` | 可选 Enterprise URL 默认留空，即公开的 `github.com`。 |
| ChatGPT 订阅（当前方式） | `openai` | **Sign in with ChatGPT**，走 pi-ai 的官方流程（需要 `@earendil-works/pi-ai` ≥ 1.0.0）。不要再在第一方插件里给 `openai` 配 API Key：同一个路由只能有一个提供方。 |
| ChatGPT / Codex 订阅（legacy） | `openai-codex` | 设备码流程，用于 GPT-5.x Codex 模型。必须先在 ChatGPT 设置里打开设备码授权，见下文。**有封号风险。** |
| Anthropic 订阅 | `anthropic` | |
| OpenRouter | `openrouter` | catalog 很大，确认需要再开启。 |
| Kimi For Coding | `kimi-coding` | |

模型列表来自已安装的 `@earendil-works/pi-ai` catalog，本插件不维护私有模型表。要更新 catalog，升该依赖并重新构建即可。

## 开启模型 vs 登录

安装后**默认休眠**：catalog 里有上述订阅，但 **`providers: {}`，不会往模型选择器灌入成百上千个模型**。

| 概念 | 含义 | 怎么做 |
|---|---|---|
| **开启 (enable)** | 向 `llm` 注册路由；模型选择器出现该提供方 | 设置 → **OAuth / 订阅** 点「开启」，或 `/oauth enable xai`，或登录时自动开启 |
| **登录 (login)** | 写入 `pi-ai-oauth.json` 订阅 token | 设置面板「登录」、`/oauth login xai`，或终端 `bin/login.mjs` |
| **关闭 (disable)** | 从选择器移除；**保留**已存 token | 设置面板「关闭」或 `/oauth disable xai` |

只有**已开启**的提供方会出现在模型列表，并与设置 → **模型**里的 API 配置（DeepSeek / pi-ai）并列。

## 安装

```sh
dsh plugin --profile web add github:ziyou979/dsh-llm-oauth
```

本地 checkout：

```sh
dsh plugin --profile web add ./dsh-llm-oauth
# 或
dsh plugin --profile web add link:E:/ProjectCollection/TSProjects/dsh-llm-oauth
```

验证层已挂上：

```sh
dsh --profile web --dump-config
```

首次从 Git 安装若提示不允许跑 `prepare`，按 CLI 提示在该 profile 的 `pnpm-workspace.yaml` 里放行（pnpm ≥10 默认拒绝生命周期脚本）：

```yaml
allowBuilds:
  dsh-llm-oauth: true
```

然后重新 `add`。也可以直接用已构建的 `lib/`（本仓库提交了构建产物时可跳过）。

## 设置 → OAuth / 订阅

Web 端在设置侧栏会多一页 **OAuth / 订阅**（在「模型」与「插件」之间）：

- 列出 catalog 中每个订阅提供方
- 徽章：**已开启 / 未开启**、**已登录 / 未登录**、浏览器登录进行中
- 操作：开启、关闭、登录、退出登录（都在本页点按钮完成，不必在聊天框输入 `/oauth`）
- 登录成功会写入 token，并自动开启
- 设备码显示在页面提示区（可复制）；授权链接会尽量新开标签，弹窗被拦时点 **打开授权页**

`openai-codex` 等需要「选择登录方式」的提供方，Web 端会**自动选设备码**。

**Sign in with ChatGPT**（`openai`，需要 pi-ai ≥ 1.0.0）会在 Host 侧起 pi-ai 的 `127.0.0.1:1455` 回调。浏览器和 Host 在同一台机器时会自动完成；无法回连时（远程 Web、端口被占），设置页会出现**粘贴框**，把浏览器最终地址贴回来即可；聊天里等价命令是 `/oauth code openai <redirect-url-or-code>`。

提供方开启（并登录）后，也会出现在设置 → **模型**，与 API Key 路由并列：

![开启订阅后的设置 → 模型](docs/models.png)

API Key 提供方仍在 **设置 → 模型** 精调。OAuth 的开启与登录在本插件这一页完成。

Host 提供轻量 HTTP API（同机 Web 使用）：

| 方法 | 路径 | Body |
|---|---|---|
| `GET` | `/dsh-llm-oauth/status` | — |
| `POST` | `/dsh-llm-oauth/enable` | `{ "provider": "xai" }` |
| `POST` | `/dsh-llm-oauth/disable` | `{ "provider": "xai" }` |
| `POST` | `/dsh-llm-oauth/login` | `{ "provider": "xai" }` |
| `POST` | `/dsh-llm-oauth/code` | `{ "provider": "openai", "code": "<redirect-url-or-code>" }` |
| `POST` | `/dsh-llm-oauth/logout` | `{ "provider": "xai" }` |

## ChatGPT：`openai`（当前）与 `openai-codex`（legacy）

`openai` 就是 pi-ai 的 **Sign in with ChatGPT**：浏览器最后落在 Host 的 `127.0.0.1:1455` 回调上，由 Host 换取 token，不需要额外开关，也不需要设备码授权。回连不到 Host 时，把最终重定向地址贴回来即可（设置页粘贴框，或 `/oauth code openai …`）。

一个注意点：`openai` 同时是第一方 **API Key** 的路由 id。如果在设置 → 模型里配了 `openai` 的 API Key，再在这里开启 `openai` 会撞 `DUPLICATE_ADAPTER`；本插件会在开启前检测并明确报错，告诉你要移除哪一边。

## ChatGPT / Codex：先打开设备码授权

Web 端的 `openai-codex` 走 **设备码**，不用本机 `:1455` 浏览器回调。ChatGPT 默认藏着这个入口，需要先打开：

1. 打开 [ChatGPT → 设置](https://chatgpt.com/)，进入 **应用与连接器**（或当前界面里的 **连接器 / Codex**）。
2. 找到 **Codex**，打开 **为 Codex 启用设备代码授权**。
3. 回到本插件设置页，对 `openai-codex` 点「登录」，再打开授权链接并输入页面上的设备码。

![为 Codex 启用设备代码授权](docs/codex-auth.png)

没开这个开关时，即使用户码是对的，授权页也会拒绝。本插件已经自动选了设备码方式，缺的是 ChatGPT 侧的许可。

**风险：** 用设备码或任何非官方客户端做 Codex / ChatGPT OAuth 登录，可能导致 ChatGPT 账号被限制或封禁。OpenAI 会把这当成在官方 Codex / ChatGPT 应用之外使用订阅。若要试，请用可丢弃的号，不要拿主力号或付不起损失的付费号登录。本插件无法防止或解除封禁。

## 命令行 / 斜杠命令

启动 Web 后在输入框：

```
/oauth status
/oauth list
/oauth enable xai
/oauth login xai
/oauth disable xai
/oauth logout xai
```

`/oauth login` 会马上返回授权链接和验证码（不会一直转圈）。浏览器里完成登录后再执行 `/oauth status`，或刷新设置页。后台会继续轮询直到登录结束。

凭据写到 `$DSH_HOME/pi-ai-oauth.json`（默认 `~/.dsh/pi-ai-oauth.json`）。

需要终端（或提供方仍要求交互式提问）时：

```sh
node bin/login.mjs --list
node bin/login.mjs xai
```

已安装进 profile 后：

```sh
node %USERPROFILE%\.dsh\profiles\web\node_modules\dsh-llm-oauth\bin\login.mjs xai
```

登录后请确认该提供方已**开启**，再在模型选择器里选对应 provider 与 catalog 模型。过期 token 由 pi-ai 在请求路径上刷新。

也可以在 `settings.yaml` 里手写：

```yaml
llm-oauth:
  providers:
    xai: {}
```

## 不要和 llm-pi-ai 抢同一条路由

`dsh-base` 会挂载休眠的 `dsh-llm-pi-ai`。如果你又在 settings 的 `llm-pi-ai:` 里配置了 `xai` / `github-copilot` 等**相同** provider id，会 `DUPLICATE_ADAPTER`。

- 订阅 / OAuth → 只用本插件
- API Key（DeepSeek、官方 OpenAI API）→ 继续用 `llm-deepseek` / `llm-pi-ai`

## 开发

```sh
pnpm install
pnpm test
pnpm run build
node bin/login.mjs --list
```

`@deepseek-ai/*` 是宿主提供的 peer；完整测试需要本机已安装或链接这些依赖。Git 安装构建不对宿主 peer 做类型检查。

## 兼容更新

- 锁文件中的 Pi 已升级到 `0.85.1`，其 Codex 目录包含 `gpt-6-astra`。
- 已对照 Harness `0.1.5-rc.2`（源码提交 `c291e7961a`）调整：提取消息首项的系统提示、传递选中的推理强度、兼容 `ToolCallId` 改名，同时保留旧版 `CallId` 支持。
- Settings 接入使用 `SettingsProvider.installSection` 服务 API；`deepEqualJson` 从宿主 peer `@deepseek-ai/dsh-util-values` 导入，避免引用新版 `dsh-settings` 已移除的独立导出。
- 锁文件已移除第三方镜像 tarball 地址，项目 `.npmrc` 使用官方 npm 源，修复 [issue #1](https://github.com/ziyou979/dsh-llm-oauth/issues/1)。正常 Git 安装可执行 `prepare`，无需跳过脚本。

## 限制

- 模型列表跟随 `@earendil-works/pi-ai`；本插件不维护私有模型表
- 图片输入仅限 pi-ai `input` 含 `image` 的模型；图片字节经宿主 `attachments` 服务读取（仅用户消息）
- 无完整 native replay 签名
- Web 端没有独立 OAuth 回调服务器（device code / 打开 URL）
- 普通 OpenAI API、DeepSeek 官方仍走 API Key
- 设置 → **模型** 页只精调 API Key（`llm-deepseek` / `llm-pi-ai`）；OAuth 开启与登录在 **设置 → OAuth / 订阅**

## License

MIT
