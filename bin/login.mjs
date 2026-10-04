#!/usr/bin/env node
/**
 * Interactive OAuth login for dsh-llm-oauth.
 *
 *   npx dsh-llm-oauth-login <provider>
 *   npx dsh-llm-oauth-login --list
 *
 * Writes credentials to $DSH_HOME/pi-ai-oauth.json (override with DSH_HOME).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { getDeviceId } from './device-id.mjs'

function resolveDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    if (fromEnv === '~') return homedir()
    if (fromEnv.startsWith('~/') || fromEnv.startsWith('~\\')) return join(homedir(), fromEnv.slice(2))
    return fromEnv
  }
  return join(homedir(), '.dsh')
}

function defaultAuthPath() {
  return join(resolveDshHome(), 'pi-ai-oauth.json')
}

class FileCredentialStore {
  constructor(path = defaultAuthPath()) {
    this.path = path
    this.cache = undefined
    this.chains = new Map()
  }

  async load() {
    if (this.cache !== undefined) return this.cache
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw)
      this.cache = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.cache = {}
    }
    return this.cache
  }

  async save(next) {
    this.cache = next
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }

  enqueue(providerId, task) {
    const previous = this.chains.get(providerId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    this.chains.set(providerId, run.then(() => undefined, () => undefined))
    return run
  }

  async read(providerId) {
    const file = await this.load()
    return file[providerId]
  }

  async list() {
    const file = await this.load()
    return Object.entries(file).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  modify(providerId, fn) {
    return this.enqueue(providerId, async () => {
      const file = { ...(await this.load()) }
      const next = await fn(file[providerId])
      if (next === undefined) return file[providerId]
      file[providerId] = next
      await this.save(file)
      return next
    })
  }

  delete(providerId) {
    return this.enqueue(providerId, async () => {
      const file = { ...(await this.load()) }
      if (file[providerId] === undefined) return
      delete file[providerId]
      await this.save(file)
    })
  }
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve))
}

async function answerPrompt(rl, authPrompt) {
  if (authPrompt.type === 'select') {
    console.log(`\n${authPrompt.message}`)
    for (let index = 0; index < authPrompt.options.length; index++) {
      console.log(`  ${index + 1}. ${authPrompt.options[index].label}`)
    }
    const choice = Number.parseInt(await prompt(rl, `Enter number (1-${authPrompt.options.length}): `), 10) - 1
    const selected = authPrompt.options[choice]
    if (!selected) throw new Error('Invalid selection')
    return selected.id
  }
  return prompt(rl, `${authPrompt.message}${authPrompt.placeholder ? ` (${authPrompt.placeholder})` : ''}: `)
}

async function main() {
  const args = process.argv.slice(2)
  const oauthProviders = builtinProviders().filter(provider => provider.auth.oauth !== undefined)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    const oauthIds = oauthProviders
      .map(provider => `  ${provider.id.padEnd(20)} ${provider.name}`)
      .join('\n')
    console.log(`Usage: dsh-llm-oauth-login <provider>

Commands:
  <provider>   Run OAuth login for one pi-ai catalog provider
  --list       List OAuth-capable catalog providers

OAuth-capable catalog providers:
${oauthIds}

Notes:
  openai signs in with ChatGPT; openai-codex is the legacy Codex login.
  Grok is provider id "xai".

Auth file: ${defaultAuthPath()}
`)
    return
  }

  if (args[0] === '--list' || args[0] === 'list') {
    for (const provider of oauthProviders) {
      console.log(`${provider.id.padEnd(20)} ${provider.name}`)
    }
    return
  }

  const providerId = args[0]
  const provider = oauthProviders.find(entry => entry.id === providerId)
  if (provider === undefined) {
    throw new Error(
      `Unknown or non-OAuth provider "${providerId}". Run --list. `
      + '(GPT subscriptions use openai or openai-codex; Grok uses xai.)',
    )
  }

  const store = new FileCredentialStore(defaultAuthPath())
  const deviceId = providerId === 'openai' ? await getDeviceId(store.path) : undefined
  const models = createModels({ credentials: store })
  models.setProvider(provider)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await models.login(providerId, 'oauth', {
      prompt: authPrompt => answerPrompt(rl, authPrompt),
      notify: event => {
        switch (event.type) {
          case 'auth_url':
            console.log(`\nOpen this URL in your browser:\n${event.url}`)
            if (event.instructions) console.log(event.instructions)
            break
          case 'device_code':
            console.log(`\nOpen this URL in your browser:\n${event.verificationUri}`)
            console.log(`Enter code: ${event.userCode}`)
            break
          case 'info':
          case 'progress':
            console.log(event.message)
            break
        }
      },
    }, deviceId === undefined ? undefined : { getDeviceId: () => deviceId })
    console.log(`\nCredentials saved to ${store.path}`)
  } finally {
    rl.close()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
