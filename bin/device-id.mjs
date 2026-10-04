import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Share a durable installation ID between the host adapter and login CLI. */
export async function getDeviceId(authPath) {
  const path = `${authPath}.device-id`
  const read = async () => {
    const value = (await readFile(path, 'utf8')).trim()
    if (!UUID.test(value)) throw new Error(`Invalid OAuth device ID in ${path}`)
    return value
  }
  try { return await read() }
  catch (error) { if (error.code !== 'ENOENT') throw error }

  await mkdir(dirname(path), { recursive: true })
  const value = randomUUID()
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${value}\n`, { flag: 'wx', mode: 0o600 })
  try {
    // Publish only a complete file; concurrent processes reuse the winner's ID.
    try { await link(temporary, path) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally { await unlink(temporary) }
  return await read()
}
