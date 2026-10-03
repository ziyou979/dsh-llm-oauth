# AGENTS.md

Standalone DeepSeek Harness plugin (`dsh-llm-oauth`). It is **not** part of the `deepseek-ai/deepseek-harness` monorepo.

Official plugin contract: [first plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md), [publish](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Contract

- Function plugin: export `name`, `inject`, `Config`, `apply`. **No `export default`.**
- Bundle: `package.json` `dsh.bundle.patch` → `cordis.patch.yml`.
- Optional web client: `package.json` `dsh.client` → `lib/client.js` (`settings.section`, id `oauth`, order 12).
- Git installs must build with `scripts/prepare.mjs` (tsdown host + client; do not typecheck DSH peers). Client needs `lightningcss`; skip it quietly if missing.
- `@deepseek-ai/*` are peers from the host profile. `@earendil-works/pi-ai` is this package's dependency (current `^1.0.0`; `openai` = Sign in with ChatGPT).
- Registrations go through `ctx.llm.registerAdapter` / `registerConfigurableProviders` / `ctx.commands.register` (when present).
- Settings namespace: `llm-oauth` (`catalog` + enabled `providers` dict). Default is dormant (`providers: {}`).
- Settings writes go through `ctx.settings.mutate(ns, …)`, which the Harness refuses unless the entry's `Config` declares at least one **volatile** field: `providers` is `.volatile()`, read with `.get()` on every operation, and the Loader commits a write into that reference in place (see `loader/volatile-update`). The entry id must equal `SETTINGS_NS` (`llm-oauth`). Do **not** call `settings.installSection` — it does not exist in the released 0.2.0 desktop runtime.
- Live settings policy: `ctx.settings.configure({ auto: false }, ctx.fiber)` — the OAuth / 订阅 client section owns the UI, so no generic auto form.
- Optional HTTP API under `/dsh-llm-oauth/*` when `webServer` is present (`ctx.inject(['webServer'], …)`).
- Do not also register the same provider id under `llm-pi-ai` (`DUPLICATE_ADAPTER`). Subscriptions here; API keys stay on first-party plugins.

## Catalog / models

- Model table is **only** `@earendil-works/pi-ai`. Do not invent local model ids.
- Do not hardcode extra model ids; bump `@earendil-works/pi-ai` when the catalog needs to move.
- Web `openai-codex` must auto-pick `device_code` (no localhost `:1455` callback). ChatGPT still requires “Enable device code authorization for Codex” on their side.
- `@earendil-works/pi-ai` ≥ 1.0.0 adds **Sign in with ChatGPT** on the `openai` provider (`openai-codex` is legacy). That flow emits `auth_url` and then races pi-ai's own `127.0.0.1:1455` callback against `prompt({ type: 'manual_code' })`, so the Web path must accept the pasted final redirect URL: `LoginWatch.prompt` → `/oauth code <provider> <value>` → `POST /dsh-llm-oauth/code`. Never throw for `manual_code`.
- `openai` is also the first-party `llm-pi-ai` API-key route: `assertRouteFree` refuses to enable a route another adapter already owns (a bare `DUPLICATE_ADAPTER` would leave the model picker empty).

## `/oauth`

Actions: `status` | `list` | `enable` | `disable` | `login` | `code` | `logout`.

`login` **must return as soon as** a URL or user code is available. DSH only renders when the handler returns; do not await the device-code poll. Poll in the background; `/oauth status` / Settings refresh report the watch.

## Commands

```sh
pnpm install
pnpm test
pnpm run build          # host (tsdown.config.ts) + client (tsdown.client.config.ts)
node bin/login.mjs --list
```
