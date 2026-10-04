import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDeviceId } from '../bin/device-id.mjs'
import { OAuthPiAiAdapter } from '../src/adapter.ts'
import { FileCredentialStore } from '../src/store.ts'

const directories: string[] = []
async function authPath() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-login-'))
  directories.push(dir)
  return join(dir, 'pi-ai-oauth.json')
}
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (!resolve(dir).startsWith(join(tmpdir(), 'dsh-oauth-login-'))) throw new Error('Unexpected test directory')
    await rm(dir, { recursive: true, force: true })
  }
})

describe('ChatGPT installation identity', () => {
  it('keeps one UUID across concurrent callers and subsequent logins', async () => {
    const path = await authPath()
    const ids = await Promise.all(Array.from({ length: 10 }, () => getDeviceId(path)))
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getDeviceId(path)).toBe(ids[0])
    expect(await readdir(directories[0]!)).toEqual(['pi-ai-oauth.json.device-id'])
  })

  it('reaches the real pi-ai authorization URL with the persisted device ID', async () => {
    const path = await authPath()
    const subject = new OAuthPiAiAdapter({ authPath: path, store: new FileCredentialStore(path), catalog: ['openai'] })
    const abort = new AbortController()
    let url: URL | undefined
    await expect(subject.login('openai', {
      signal: abort.signal,
      notify: event => {
        if (event.type === 'auth_url') {
          url = new URL(event.url)
          abort.abort(new Error('Stop before token exchange'))
        }
      },
      prompt: async prompt => {
        prompt.signal?.throwIfAborted()
        throw new Error('Unexpected prompt')
      },
    })).rejects.toThrow(/Stop before token exchange/)
    expect(url?.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${await getDeviceId(path)}`)
  })

  it('completes the CLI manual redirect flow using real pi-ai and a stub token endpoint', async () => {
    const path = await authPath()
    const deviceId = await getDeviceId(path)
    const token = { access_token: 'test-access', refresh_token: 'test-refresh', id_token: 'test-id',
      expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' }
    const preload = `globalThis.fetch = async (url) => {
      if (String(url) !== 'https://auth.openai.com/api/accounts/oauth/token') throw new Error('Unexpected request');
      return new Response(${JSON.stringify(JSON.stringify(token))}, {status: 200});
    };`
    const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'bin/login.mjs', 'openai'], {
      cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, DSH_HOME: directories.at(-1)! },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let errors = ''
    let sent = false
    let hostId: string | null = null
    const completed = new Promise<number | null>((resolveExit, reject) => {
      child.on('error', reject)
      child.on('exit', resolveExit)
      child.stderr.on('data', chunk => { errors += String(chunk) })
      child.stdout.on('data', chunk => {
        output += String(chunk)
        const match = output.match(/https:\/\/auth\.openai\.com\/api\/accounts\/authorize\?[^\s]+/)
        if (!sent && match && output.includes('Complete login in your browser, or paste')) {
          sent = true
          const url = new URL(match[0])
          hostId = url.searchParams.get('ext_agent_host_id')
          child.stdin.write(`http://127.0.0.1:1455/auth/callback?code=test&client_id=test-client&state=${url.searchParams.get('state')}\n`)
        }
      })
    })
    const timer = setTimeout(() => child.kill(), 10_000)
    try {
      expect(await completed, errors).toBe(0)
      expect(hostId).toBe(`urn:uuid:${deviceId}`)
      expect(output).toContain('Credentials saved')
      expect(await new FileCredentialStore(path).read('openai')).toMatchObject({ type: 'oauth', access: 'test-access' })
      expect(await getDeviceId(path)).toBe(deviceId)
    } finally { clearTimeout(timer); child.kill() }
  })
})
