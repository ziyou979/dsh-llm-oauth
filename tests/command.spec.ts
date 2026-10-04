import { describe, expect, it, beforeEach, vi } from 'vitest'
import { handleOauthCommand, listLoginWatches, resetLoginWatches, submitLoginCode } from '../src/command.ts'
import { OAuthController } from '../src/service.ts'
import type { OAuthPiAiAdapter } from '../src/adapter.ts'

function fakeAdapter(login: OAuthPiAiAdapter['login']): OAuthPiAiAdapter {
  return {
    authPath: () => '/tmp/pi-ai-oauth.json',
    catalogIds: () => ['xai'],
    routeIds: () => ['xai'],
    displayName: () => 'xAI',
    checkAuth: async () => undefined,
    logout: async () => undefined,
    login,
  } as unknown as OAuthPiAiAdapter
}

describe('/oauth login', () => {
  beforeEach(() => {
    resetLoginWatches()
  })

  it('returns the device-code URL without waiting for the browser', async () => {
    let finish!: (value: { type: 'oauth' }) => void
    const hung = new Promise<{ type: 'oauth' }>(resolve => {
      finish = resolve
    })
    const adapter = fakeAdapter(async (_provider, interaction) => {
      interaction.notify({
        type: 'device_code',
        verificationUri: 'https://auth.x.ai/device',
        userCode: 'ABCD-1234',
      })
      return hung
    })

    const result = await handleOauthCommand(adapter, 'login xai')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('https://auth.x.ai/device')
    expect(result.text).toContain('ABCD-1234')
    expect(result.text).toContain('background')
    expect(listLoginWatches()).toMatchObject([{ provider: 'xai', status: 'waiting' }])
    finish({ type: 'oauth' })
    await hung
    await vi.waitFor(() => expect(listLoginWatches()[0]?.status).toBe('ok'))
  })

  it('fails immediately when the provider never issues a URL', async () => {
    const adapter = fakeAdapter(async () => {
      throw new Error('xAI OAuth device authorization failed (HTTP 401)')
    })
    const result = await handleOauthCommand(adapter, 'login xai')
    expect(result).toEqual({
      kind: 'error',
      text: 'xAI OAuth device authorization failed (HTTP 401)',
    })
  })

  it('repeats the waiting notice if login is already in flight', async () => {
    const adapter = fakeAdapter(async (_provider, interaction) => {
      interaction.notify({
        type: 'device_code',
        verificationUri: 'https://auth.x.ai/device',
        userCode: 'WAIT-0001',
      })
      return new Promise(() => undefined)
    })
    await handleOauthCommand(adapter, 'login xai')
    const again = await handleOauthCommand(adapter, 'login xai')
    expect(again.text).toContain('WAIT-0001')
    expect(listLoginWatches()).toHaveLength(1)
  })

  it('auto-answers openai-codex select prompts with device_code', async () => {
    let chosen: string | undefined
    const adapter = {
      authPath: () => '/tmp/pi-ai-oauth.json',
      catalogIds: () => ['openai-codex'],
      routeIds: () => ['openai-codex'],
      displayName: () => 'OpenAI Codex',
      checkAuth: async () => undefined,
      logout: async () => undefined,
      login: async (_provider, interaction) => {
        chosen = await interaction.prompt({
          type: 'select',
          message: 'Select OpenAI Codex login method:',
          options: [
            { id: 'browser', label: 'Browser login (default)' },
            { id: 'device_code', label: 'Device code login (headless)' },
          ],
        })
        interaction.notify({
          type: 'device_code',
          verificationUri: 'https://auth.openai.com/codex/device',
          userCode: 'CODEX-99',
        })
        return new Promise(() => undefined)
      },
    } as unknown as OAuthPiAiAdapter

    const result = await handleOauthCommand(adapter, 'login openai-codex')
    expect(chosen).toBe('device_code')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('CODEX-99')
    expect(result.text).toContain('device_code')
    expect(result.openUrl).toBe('https://auth.openai.com/codex/device')
    expect(result.userCode).toBe('CODEX-99')
  })

  it('auto-answers github-copilot enterprise prompt with blank (github.com)', async () => {
    let enterprise: string | undefined
    const adapter = {
      authPath: () => '/tmp/pi-ai-oauth.json',
      catalogIds: () => ['github-copilot'],
      routeIds: () => ['github-copilot'],
      displayName: () => 'GitHub Copilot',
      checkAuth: async () => undefined,
      logout: async () => undefined,
      login: async (_provider, interaction) => {
        enterprise = await interaction.prompt({
          type: 'text',
          message: 'GitHub Enterprise URL/domain (blank for github.com)',
          placeholder: 'company.ghe.com',
        })
        interaction.notify({
          type: 'device_code',
          verificationUri: 'https://github.com/login/device',
          userCode: 'GH-1234',
        })
        return new Promise(() => undefined)
      },
    } as unknown as OAuthPiAiAdapter

    const result = await handleOauthCommand(adapter, 'login github-copilot')
    expect(enterprise).toBe('')
    expect(result.kind).toBe('success')
    expect(result.openUrl).toBe('https://github.com/login/device')
    expect(result.userCode).toBe('GH-1234')
  })

  it('accepts a manual redirect and finishes the background login', async () => {
    let pasted: string | undefined
    const adapter = fakeAdapter(async (_provider, interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://example.com/auth' })
      pasted = await interaction.prompt({ type: 'manual_code', message: 'Paste redirect' })
      return { type: 'oauth', access: 'test', refresh: 'test', expires: 0 }
    })
    const result = await handleOauthCommand(adapter, 'login xai')
    expect(result.openUrl).toBe('https://example.com/auth')
    expect(listLoginWatches()[0]?.prompt?.type).toBe('manual_code')
    expect(submitLoginCode('xai', '  http://localhost/callback?code=test  ')).toBe(true)
    await vi.waitFor(() => expect(listLoginWatches()[0]?.status).toBe('ok'))
    expect(pasted).toBe('http://localhost/callback?code=test')
    expect(listLoginWatches()[0]?.prompt).toBeUndefined()
  })

  it.each(['command', 'controller'])('cancels pending login before %s logout and allows a fresh prompt', async (path) => {
    let oldCallback!: () => void
    let oldSignal: AbortSignal | undefined
    let oldManual!: Promise<string>
    let attempts = 0
    const adapter = fakeAdapter(async (_provider, interaction) => {
      const attempt = ++attempts
      interaction.notify({ type: 'auth_url', url: 'https://example.com/auth' })
      const manual = interaction.prompt({ type: 'manual_code', message: 'Paste redirect' })
      if (attempt === 1) {
        oldSignal = interaction.signal
        oldManual = manual
        await Promise.race([manual, new Promise<void>(resolve => { oldCallback = resolve })])
      } else await manual
      return { type: 'oauth', access: 'test', refresh: 'test', expires: 0 }
    })
    const logout = vi.spyOn(adapter, 'logout').mockImplementation(async () => {
      expect(oldSignal?.aborted).toBe(true)
      expect(submitLoginCode('xai', 'stale')).toBe(false)
    })
    await handleOauthCommand(adapter, 'login xai')
    if (path === 'command') await handleOauthCommand(adapter, 'logout xai')
    else await new OAuthController(adapter, {
      listEnabled: () => [], enable: async () => {}, disable: async () => {},
    }).logout('xai')
    expect(logout).toHaveBeenCalledOnce()
    await expect(oldManual).rejects.toThrow(/cancelled/)
    await handleOauthCommand(adapter, 'login xai')
    oldCallback()
    await Promise.resolve()
    expect(submitLoginCode('xai', 'new redirect')).toBe(true)
    await vi.waitFor(() => expect(listLoginWatches()[0]?.status).toBe('ok'))
  })

  it('withdraws the manual prompt when pi-ai cancels it after a browser callback', async () => {
    const promptAbort = new AbortController()
    let finish!: () => void
    const adapter = fakeAdapter(async (_provider, interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://example.com/auth' })
      const manual = interaction.prompt({ type: 'manual_code', message: 'Paste redirect', signal: promptAbort.signal })
      void manual.catch(() => undefined)
      await new Promise<void>(resolve => { finish = resolve })
      return { type: 'oauth', access: 'test', refresh: 'test', expires: 0 }
    })
    await handleOauthCommand(adapter, 'login xai')
    promptAbort.abort()
    expect(listLoginWatches()[0]?.prompt).toBeUndefined()
    expect(submitLoginCode('xai', 'stale redirect')).toBe(false)
    finish()
    await vi.waitFor(() => expect(listLoginWatches()[0]?.status).toBe('ok'))
  })
})
