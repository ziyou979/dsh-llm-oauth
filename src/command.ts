/**
 * `/oauth` slash command: status / list / enable / disable / login / logout.
 *
 * Login cannot wait for the browser: DSH commands only render when the
 * handler returns, so a device-code poll looks like a hung `/oauth`. The
 * handler returns as soon as pi-ai notifies a URL or user code, and the
 * poll continues in the background.
 */

import type { OAuthPiAiAdapter } from './adapter.ts'

export interface CommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
  /** Browser URL the client should open (auth_url or device verification). */
  readonly openUrl?: string
  /** Device code the user must enter, when applicable. */
  readonly userCode?: string
}

/** A prompt the background login waits on (pi-ai `manual_code`). */
export interface LoginPrompt {
  /** pi-ai prompt type, e.g. `manual_code`. */
  readonly type: string
  /** Prompt text shown to the person. */
  readonly message: string
  /** Placeholder / expected value shape (usually the redirect URI). */
  readonly placeholder?: string
}

/** In-flight or last-finished login, keyed by provider id. */
export interface LoginWatch {
  readonly provider: string
  status: 'waiting' | 'ok' | 'error'
  detail?: string
  openUrl?: string
  userCode?: string
  /** Prompt awaiting a pasted value, when the login cannot continue alone. */
  prompt?: LoginPrompt
  readonly lines: string[]
}

const watches = new Map<string, LoginWatch>()
/** Resolvers for prompts awaiting a pasted value, keyed by provider id. */
const pendingPrompts = new Map<string, (value: string) => void>()

/** Test helper: drop every background login watch. */
export function resetLoginWatches(): void {
  watches.clear()
  pendingPrompts.clear()
}

/**
 * Answer the prompt a background login is waiting on — the value pi-ai asks for
 * when a browser callback cannot complete (Sign in with ChatGPT on a remote
 * Web UI, or a busy :1455 callback port).
 * @param provider - provider id whose login is waiting.
 * @param value - pasted final redirect URL or authorization code.
 * @returns whether a waiting prompt consumed the value.
 */
export function submitLoginCode(provider: string, value: string): boolean {
  const resolve = pendingPrompts.get(provider)
  if (resolve === undefined) return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  pendingPrompts.delete(provider)
  const watch = watches.get(provider)
  if (watch !== undefined) {
    delete watch.prompt
    watch.lines.push('Submitted the pasted value; finishing the sign-in…')
  }
  resolve(trimmed)
  return true
}

/** Snapshot of background login watches (for tests and `/oauth status`). */
export function listLoginWatches(): readonly LoginWatch[] {
  return [...watches.values()]
}

function usageText(authPath: string): string {
  return [
    'Usage:',
    '  /oauth status',
    '  /oauth list',
    '  /oauth enable <provider>',
    '  /oauth disable <provider>',
    '  /oauth login <provider>',
    '  /oauth code <provider> <redirect-url-or-code>',
    '  /oauth logout <provider>',
    '',
    `Auth file: ${authPath}`,
    '',
    'Notes:',
    '  - Only enabled providers appear in the model picker.',
    '  - login auto-enables the provider when settings are available.',
    '  - GPT subscriptions: "openai" is Sign in with ChatGPT (pi-ai >= 1.0.0);',
    '    "openai-codex" is the legacy device-code flow for the Codex models.',
    '  - Grok is provider id "xai".',
    '  - Do not also configure the same provider id under llm-pi-ai (DUPLICATE_ADAPTER):',
    '    an id one adapter already owns is refused here with a clear error.',
    '  - Prefer Settings → OAuth / 订阅 for status + enable toggles.',
  ].join('\n')
}

function formatEvent(event: {
  type: string
  message?: string
  url?: string
  instructions?: string
  verificationUri?: string
  userCode?: string
}): string[] {
  switch (event.type) {
    case 'auth_url':
      return [
        `Open this URL:\n${event.url ?? ''}`,
        ...event.instructions ? [event.instructions] : [],
      ]
    case 'device_code':
      return [
        `Open this URL:\n${event.verificationUri ?? ''}`,
        `Enter code: ${event.userCode ?? ''}`,
      ]
    case 'info':
    case 'progress':
      return event.message ? [event.message] : []
    default:
      return []
  }
}

function isLoginNotice(type: string): boolean {
  return type === 'device_code' || type === 'auth_url'
}

/**
 * Choose a non-interactive answer for a select prompt.
 * Prefer device-code / headless options when present (Web has no local
 * OAuth callback port for browser login).
 */
function pickSelectOption(
  provider: string,
  options: readonly { id: string, label: string, description?: string }[],
): { id: string, label: string } {
  const byId = (id: string) => options.find(option => option.id === id)
  // openai-codex: browser needs localhost:1455 callback; device_code works in Web.
  if (provider === 'openai-codex') {
    const device = byId('device_code')
    if (device !== undefined) return device
  }
  const headless = options.find(option =>
    /device[_-]?code|headless|cli/i.test(`${option.id} ${option.label} ${option.description ?? ''}`))
  if (headless !== undefined) return headless
  // First option is usually the provider default.
  return options[0]!
}

/**
 * Answer a text prompt without a terminal when a blank / default is valid.
 * github-copilot asks for Enterprise URL with blank = github.com.
 */
function answerOptionalTextPrompt(
  provider: string,
  prompt: { type: string, message: string, placeholder?: string },
): string | undefined {
  if (prompt.type !== 'text') return undefined
  const blob = `${prompt.message} ${prompt.placeholder ?? ''}`.toLowerCase()
  if (provider === 'github-copilot' || /enterprise|blank for github\.com|github\.com/i.test(blob)) {
    // Empty → public github.com (pi-ai treats blank as non-enterprise).
    return ''
  }
  // Generic “blank for default” wording.
  if (/\bblank\b|\boptional\b|\bleave empty\b|\(empty\)/i.test(blob)) {
    return ''
  }
  return undefined
}

function resultExtras(watch: LoginWatch): Pick<CommandResult, 'openUrl' | 'userCode'> {
  return {
    ...watch.openUrl === undefined ? {} : { openUrl: watch.openUrl },
    ...watch.userCode === undefined ? {} : { userCode: watch.userCode },
  }
}

function waitingText(watch: LoginWatch): string {
  return [
    ...watch.lines,
    '',
    `Finish signing in to ${watch.provider} in the browser.`,
    ...watch.prompt === undefined
      ? []
      : [
        `If the browser callback cannot reach this machine, paste the value it asks for `
        + `(${watch.prompt.message}) in Settings → OAuth / 订阅, or run:`,
        `  /oauth code ${watch.provider} <redirect-url-or-code>`,
      ],
    'This command has returned so the UI is not stuck; the login continues in the background.',
    'When you are done, run /oauth status or refresh Settings → OAuth / 订阅.',
  ].join('\n')
}

/**
 * Start OAuth and return as soon as the user has something to open.
 * The device-code poll is not bound to the command AbortSignal — the Web
 * request ends when this handler returns, and aborting it would cancel login.
 */
async function startLogin(
  adapter: OAuthPiAiAdapter,
  provider: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const existing = watches.get(provider)
  if (existing?.status === 'waiting') {
    return { kind: 'success', text: waitingText(existing), ...resultExtras(existing) }
  }

  const lines: string[] = []
  const watch: LoginWatch = { provider, status: 'waiting', lines }
  watches.set(provider, watch)

  let released = false
  let release!: (error?: Error) => void
  const firstNotice = new Promise<void>((resolve, reject) => {
    release = (error?: Error): void => {
      if (released) return
      released = true
      if (error === undefined) resolve()
      else reject(error)
    }
  })

  const onAbort = (): void => {
    release(new Error('oauth login cancelled before the provider returned a URL'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const interaction = {
    prompt: async (prompt: {
      type: string
      message: string
      placeholder?: string
      options?: readonly { id: string, label: string, description?: string }[]
    }): Promise<string> => {
      // Web / slash-command has no stdin. Auto-pick select menus so providers
      // like openai-codex (browser vs device code) can continue to a URL/code.
      if (prompt.type === 'select' && prompt.options !== undefined && prompt.options.length > 0) {
        const preferred = pickSelectOption(provider, prompt.options)
        lines.push(
          `${prompt.message} → ${preferred.label} (${preferred.id})`,
        )
        return preferred.id
      }
      // github-copilot: optional Enterprise URL — blank means github.com.
      const optionalText = answerOptionalTextPrompt(provider, prompt)
      if (optionalText !== undefined) {
        lines.push(
          optionalText.length === 0
            ? `${prompt.message} → (default / blank)`
            : `${prompt.message} → ${optionalText}`,
        )
        return optionalText
      }
      // Nothing else can be answered without a person — pi-ai's ChatGPT sign-in
      // asks for the final redirect URL when its :1455 callback cannot finish.
      // Record the prompt and wait for the value the UI submits.
      watch.prompt = {
        type: prompt.type,
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
      lines.push(
        `${prompt.message}${prompt.placeholder === undefined ? '' : ` (${prompt.placeholder})`}`,
      )
      return await new Promise<string>((resolve) => {
        pendingPrompts.set(provider, resolve)
      })
    },
    notify: (event: {
      type: string
      message?: string
      url?: string
      instructions?: string
      verificationUri?: string
      userCode?: string
    }): void => {
      lines.push(...formatEvent(event))
      if (event.type === 'auth_url' && event.url) {
        watch.openUrl = event.url
      }
      if (event.type === 'device_code') {
        if (event.verificationUri) watch.openUrl = event.verificationUri
        if (event.userCode) watch.userCode = event.userCode
      }
      if (isLoginNotice(event.type)) release()
    },
  }

  const finished = adapter.login(provider, interaction).then(
    () => {
      watch.status = 'ok'
      watch.detail = `Logged in to ${provider}. Tokens stored in ${adapter.authPath()}.`
    },
    (error: unknown) => {
      watch.status = 'error'
      watch.detail = error instanceof Error ? error.message : String(error)
      release(error instanceof Error ? error : new Error(watch.detail))
    },
  ).finally(() => {
    // A prompt this login no longer waits on must not linger in the UI.
    pendingPrompts.delete(provider)
    delete watch.prompt
  })

  try {
    await firstNotice
  } catch (error) {
    signal?.removeEventListener('abort', onAbort)
    return {
      kind: 'error',
      text: [watch.detail ?? (error instanceof Error ? error.message : String(error)), ...lines].join('\n'),
      ...resultExtras(watch),
    }
  }
  signal?.removeEventListener('abort', onAbort)

  // Keep the poll alive after this command returns.
  void finished

  if (watch.status === 'ok') {
    return {
      kind: 'success',
      text: watch.detail ?? `Logged in to ${provider}.`,
      ...resultExtras(watch),
    }
  }
  return { kind: 'success', text: waitingText(watch), ...resultExtras(watch) }
}

/**
 * Execute `/oauth` against the live adapter.
 * @param adapter - registered OAuth adapter.
 * @param rawInput - text after the command name.
 * @param signal - UI request cancellation; only aborts waiting for the first URL.
 */
export async function handleOauthCommand(
  adapter: OAuthPiAiAdapter,
  rawInput: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean)
  const action = (parts[0] ?? 'status').toLowerCase()
  const target = parts[1]
  const catalog = typeof adapter.catalogIds === 'function' ? adapter.catalogIds() : adapter.routeIds()

  if (action === 'help' || action === '-h' || action === '--help') {
    return { kind: 'success', text: usageText(adapter.authPath()) }
  }

  if (action === 'list') {
    const rows = ['OAuth catalog owned by this plugin:']
    for (const id of catalog) {
      const auth = await adapter.checkAuth(id)
      rows.push(`  ${id.padEnd(20)} ${auth === undefined ? 'not logged in' : `${auth.type}${auth.source ? ` (${auth.source})` : ''}`}`)
    }
    rows.push('', 'Enable a provider with `/oauth enable <id>` or Settings → OAuth / 订阅.')
    return { kind: 'success', text: rows.join('\n') }
  }

  // Sign in with ChatGPT (and any other callback flow) may need the value the
  // browser ended on when its :1455 callback cannot reach this machine.
  if (action === 'code') {
    if (target === undefined) {
      return { kind: 'error', text: 'Usage: /oauth code <provider> <redirect-url-or-code>' }
    }
    const value = parts.slice(2).join(' ')
    if (value.length === 0) {
      return { kind: 'error', text: 'Usage: /oauth code <provider> <redirect-url-or-code>' }
    }
    if (!submitLoginCode(target, value)) {
      return {
        kind: 'error',
        text: `${target} is not waiting for a pasted value. Start /oauth login ${target} first.`,
      }
    }
    return {
      kind: 'success',
      text: `Submitted the value for ${target}; the sign-in continues in the background. `
        + 'Run /oauth status or refresh Settings → OAuth / 订阅.',
    }
  }

  if (action === 'status') {
    const rows = [`Auth file: ${adapter.authPath()}`, '']
    for (const id of catalog) {
      const auth = await adapter.checkAuth(id)
      const watch = watches.get(id)
      const login = auth === undefined ? 'not logged in' : `ok (${auth.type}${auth.source ? `, ${auth.source}` : ''})`
      const extra = watch === undefined
        ? ''
        : watch.status === 'waiting'
          ? ' — browser login in progress'
          : watch.status === 'error'
            ? ` — last login error: ${watch.detail ?? 'failed'}`
            : ' — last login finished'
      rows.push(`${id}: ${login}${extra}`)
    }
    rows.push('', 'Tip: only enabled providers list models. Use /oauth enable <id> or the Settings panel.')
    return { kind: 'success', text: rows.join('\n') }
  }

  if (action === 'logout') {
    if (target === undefined) return { kind: 'error', text: 'Usage: /oauth logout <provider>' }
    try {
      watches.delete(target)
      pendingPrompts.delete(target)
      await adapter.logout(target)
      return { kind: 'success', text: `Logged out ${target}.` }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  }

  if (action === 'login') {
    if (target === undefined) {
      return { kind: 'error', text: 'Usage: /oauth login <provider>' }
    }
    return startLogin(adapter, target, signal)
  }

  // enable/disable are handled in runtime when settings exist; keep a clear error here.
  if (action === 'enable' || action === 'disable') {
    return {
      kind: 'error',
      text: `/${action} is handled by the plugin runtime. If you see this, settings may be unavailable.\n\n${usageText(adapter.authPath())}`,
    }
  }

  return { kind: 'error', text: `Unknown action "${action}".\n\n${usageText(adapter.authPath())}` }
}
