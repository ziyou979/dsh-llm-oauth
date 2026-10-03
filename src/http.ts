/**
 * Optional loopback HTTP API for the Settings → OAuth client panel.
 *
 * Mounted only when `ctx.webServer` exists. Paths are under `/dsh-llm-oauth/*`
 * so they never collide with the first-party `/api` RPC surface.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OAuthController } from './service.ts'
import { handleOauthCommand } from './command.ts'

const API_PREFIX = '/dsh-llm-oauth'

/** JSON helper. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Read a small JSON object body. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const total = chunks.reduce((sum, part) => sum + part.length, 0)
    if (total > 64_000) throw new Error('request body too large')
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw.length === 0) return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

function providerOf(body: Record<string, unknown>, url: URL): string | undefined {
  const fromQuery = url.searchParams.get('provider')
  if (fromQuery !== null && fromQuery.length > 0) return fromQuery
  const value = body.provider
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Handle one request under `/dsh-llm-oauth`.
 * @param controller - OAuth control plane.
 * @param req - incoming request.
 * @param res - server response.
 */
export async function handleOauthHttp(
  controller: OAuthController,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const host = req.headers.host ?? '127.0.0.1'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  try {
    if (method === 'GET' && (path === API_PREFIX || path === `${API_PREFIX}/status`)) {
      sendJson(res, 200, await controller.status())
      return
    }

    if (method === 'POST' && path === `${API_PREFIX}/enable`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      await controller.enable(provider)
      sendJson(res, 200, await controller.status())
      return
    }

    if (method === 'POST' && path === `${API_PREFIX}/disable`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      await controller.disable(provider)
      sendJson(res, 200, await controller.status())
      return
    }

    if (method === 'POST' && path === `${API_PREFIX}/code`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      const value = typeof body.code === 'string' ? body.code
        : typeof body.value === 'string' ? body.value : undefined
      if (provider === undefined || value === undefined || value.trim().length === 0) {
        sendJson(res, 400, { error: 'missing provider or code' })
        return
      }
      controller.submitCode(provider, value)
      sendJson(res, 200, {
        ...await controller.status(),
        command: {
          kind: 'success',
          text: `Submitted the value for ${provider}; the sign-in continues in the background.`,
        },
      })
      return
    }

    if (method === 'POST' && path === `${API_PREFIX}/logout`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      await controller.logout(provider)
      sendJson(res, 200, await controller.status())
      return
    }

    if (method === 'POST' && path === `${API_PREFIX}/login`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      // Enabling before login makes the route appear as soon as tokens land.
      await controller.enable(provider)
      const result = await handleOauthCommand(controller.getAdapter(), `login ${provider}`)
      const status = await controller.status()
      sendJson(res, result.kind === 'error' ? 400 : 200, {
        ...status,
        command: result,
      })
      return
    }

    sendJson(res, 404, { error: `unknown route ${path}` })
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Exact path registered on webServer. */
export const OAUTH_HTTP_PREFIX = API_PREFIX
