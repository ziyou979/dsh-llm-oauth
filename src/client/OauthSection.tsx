/**
 * Settings → OAuth / 订阅: enable toggles + login status.
 * Talks to the host plugin over `/dsh-llm-oauth/*` (not Typert RPC).
 * On login, opens the authorization URL in a new window when the host returns one.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  disableOauthProvider,
  enableOauthProvider,
  fetchOauthStatus,
  loginOauthProvider,
  logoutOauthProvider,
  submitOauthCode,
  type OAuthLoginCommand,
  type OAuthProviderStatus,
  type OAuthStatusSnapshot,
} from './api.ts'
import type { OauthSettingsKey } from './locales.ts'
import styles from './OauthSection.module.css'

export interface OauthSectionInjected {
  t: (key: OauthSettingsKey) => string
}

export type OauthSectionProps = Partial<OauthSectionInjected>

type BusyAction = 'enable' | 'disable' | 'login' | 'logout' | 'code' | 'refresh'

/** Try to open the OAuth URL; returns false if the browser blocked the popup. */
function tryOpenAuthWindow(url: string): boolean {
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    return win !== null
  } catch {
    return false
  }
}

function extractHttpUrl(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const match = text.match(/https?:\/\/[^\s]+/i)
  return match?.[0]
}

export function OauthSection(props: OauthSectionProps): ReactNode {
  const { t } = props
  if (t === undefined) return null
  return <Loaded t={t} />
}

function Loaded({ t }: { t: (key: OauthSettingsKey) => string }): ReactNode {
  const [status, setStatus] = useState<OAuthStatusSnapshot | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<{ id?: string, action: BusyAction } | undefined>(undefined)
  const [command, setCommand] = useState<OAuthLoginCommand | undefined>(undefined)
  const [popupBlocked, setPopupBlocked] = useState(false)

  const load = useCallback(async () => {
    setBusy({ action: 'refresh' })
    setError(undefined)
    try {
      const next = await fetchOauthStatus()
      setStatus(next)
      setCommand(undefined)
      setPopupBlocked(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const applyLoginResult = (next: OAuthStatusSnapshot): void => {
    setStatus(next)
    const cmd = next.command
    setCommand(cmd)
    if (cmd?.kind === 'error' && cmd.text) setError(cmd.text)
    const url = cmd?.openUrl ?? extractHttpUrl(cmd?.text)
    if (url !== undefined && cmd?.kind !== 'error') {
      const opened = tryOpenAuthWindow(url)
      setPopupBlocked(!opened)
    } else {
      setPopupBlocked(false)
    }
  }

  const run = async (
    provider: string,
    action: Exclude<BusyAction, 'refresh'>,
    fn: (id: string) => Promise<OAuthStatusSnapshot>,
  ): Promise<void> => {
    setBusy({ id: provider, action })
    setError(undefined)
    if (action !== 'login' && action !== 'code') {
      setCommand(undefined)
      setPopupBlocked(false)
    }
    try {
      const next = await fn(provider)
      if (action === 'login') applyLoginResult(next)
      else {
        setStatus(next)
        setCommand(next.command)
        setError(next.command?.kind === 'error' ? next.command.text : undefined)
        if (action !== 'code') setPopupBlocked(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  if (status === undefined && error === undefined) {
    return (
      <div className={styles.section}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.notice}>{t('loading')}</p>
      </div>
    )
  }

  if (status === undefined) {
    return (
      <div className={styles.section}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.error}>{`${t('loadFailed')}: ${error ?? ''}`}</p>
        <div className={styles.toolbar}>
          <button type="button" className={styles.secondaryButton} onClick={() => { void load() }}>
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  const globalBusy = busy?.action === 'refresh'
  const authUrl = command?.openUrl ?? extractHttpUrl(command?.text)
  const userCode = command?.userCode

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <p className={styles.intro}>{t('intro')}</p>
      <p className={styles.meta}>{`${t('authFile')}: ${status.authPath}`}</p>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={globalBusy}
          onClick={() => { void load() }}
        >
          {globalBusy ? t('busy') : t('refresh')}
        </button>
      </div>
      {error !== undefined ? <p className={styles.error}>{error}</p> : null}
      {popupBlocked ? <p className={styles.error}>{t('popupBlocked')}</p> : null}
      {userCode !== undefined
        ? (
          <div className={styles.codeBox} role="status">
            <span className={styles.codeLabel}>{t('userCodeLabel')}</span>
            <code className={styles.codeValue}>{userCode}</code>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => { void navigator.clipboard?.writeText(userCode) }}
            >
              {t('copyCode')}
            </button>
          </div>
        )
        : null}
      {authUrl !== undefined
        ? (
          <div className={styles.toolbar}>
            <a
              className={styles.buttonLink}
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { setPopupBlocked(false) }}
            >
              {t('openAuth')}
            </a>
          </div>
        )
        : null}
      {command?.text !== undefined ? <p className={styles.command} role="status">{command.text}</p> : null}
      {status.providers.length === 0
        ? <p className={styles.notice}>{t('empty')}</p>
        : (
          <ul className={styles.rows}>
            {status.providers.map(row => (
              <ProviderRow
                key={row.id}
                row={row}
                t={t}
                busy={busy}
                onEnable={() => { void run(row.id, 'enable', enableOauthProvider) }}
                onDisable={() => { void run(row.id, 'disable', disableOauthProvider) }}
                onLogin={() => { void run(row.id, 'login', loginOauthProvider) }}
                onLogout={() => { void run(row.id, 'logout', logoutOauthProvider) }}
                onSubmitCode={code => { void run(row.id, 'code', id => submitOauthCode(id, code)) }}
              />
            ))}
          </ul>
        )}
      <p className={styles.notice}>{t('tipEnable')}</p>
      <p className={styles.notice}>{t('tipLogin')}</p>
    </div>
  )
}

function ProviderRow(props: {
  row: OAuthProviderStatus
  t: (key: OauthSettingsKey) => string
  busy: { id?: string, action: BusyAction } | undefined
  onEnable: () => void
  onDisable: () => void
  onLogin: () => void
  onLogout: () => void
  onSubmitCode: (code: string) => void
}): ReactNode {
  const { row, t, busy, onEnable, onDisable, onLogin, onLogout, onSubmitCode } = props
  const rowBusy = busy?.id === row.id
  const disabled = busy !== undefined
  const [code, setCode] = useState('')

  const submit = (): void => {
    const value = code.trim()
    if (value.length === 0) return
    setCode('')
    onSubmitCode(value)
  }

  return (
    <li className={styles.rowCard}>
      <div className={styles.rowHead}>
        <div className={styles.rowIdentity}>
          <span className={styles.rowName}>{row.name}</span>
          <span className={styles.rowId}>{row.id}</span>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${row.enabled ? styles.badgeOn : styles.badgeOff}`}>
              {row.enabled ? t('enabled') : t('disabled')}
            </span>
            <span className={`${styles.badge} ${row.loggedIn ? styles.badgeOk : styles.badgeMissing}`}>
              {row.loggedIn
                ? `${t('loggedIn')}${row.authType ? ` (${row.authType})` : ''}`
                : t('loggedOut')}
            </span>
            {row.loginStatus === 'waiting'
              ? <span className={`${styles.badge} ${styles.badgeWarn}`}>{t('loginWaiting')}</span>
              : null}
            {row.loginStatus === 'error'
              ? <span className={`${styles.badge} ${styles.badgeMissing}`}>{t('loginError')}</span>
              : null}
          </div>
          {row.id === 'openrouter' && !row.enabled
            ? <p className={styles.notice}>{t('openrouterWarn')}</p>
            : null}
          {row.id === 'openai'
            ? <p className={styles.notice}>{t('openaiWarn')}</p>
            : null}
          {row.loginDetail !== undefined && row.loginStatus === 'error'
            ? <p className={styles.error}>{row.loginDetail}</p>
            : null}
        </div>
      </div>
      {row.loginPrompt !== undefined
        ? (
          <form
            className={styles.codeBox}
            onSubmit={(event) => { event.preventDefault(); submit() }}
          >
            <span className={styles.codeLabel}>{row.loginPrompt.message}</span>
            <input
              className={styles.codeInput}
              type="text"
              value={code}
              disabled={disabled}
              placeholder={row.loginPrompt.placeholder ?? t('pastePlaceholder')}
              onChange={(event) => { setCode(event.target.value) }}
            />
            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={disabled || code.trim().length === 0}
            >
              {rowBusy && busy?.action === 'code' ? t('busy') : t('submitCode')}
            </button>
          </form>
        )
        : null}
      <div className={styles.rowActions}>
        {row.enabled
          ? (
            <button type="button" className={styles.secondaryButton} disabled={disabled} onClick={onDisable}>
              {rowBusy && busy?.action === 'disable' ? t('busy') : t('disable')}
            </button>
          )
          : (
            <button type="button" className={styles.button} disabled={disabled} onClick={onEnable}>
              {rowBusy && busy?.action === 'enable' ? t('busy') : t('enable')}
            </button>
          )}
        {row.loggedIn
          ? (
            <button type="button" className={styles.dangerButton} disabled={disabled} onClick={onLogout}>
              {rowBusy && busy?.action === 'logout' ? t('busy') : t('logout')}
            </button>
          )
          : (
            <button type="button" className={styles.secondaryButton} disabled={disabled} onClick={onLogin}>
              {rowBusy && busy?.action === 'login' ? t('busy') : t('login')}
            </button>
          )}
      </div>
    </li>
  )
}
