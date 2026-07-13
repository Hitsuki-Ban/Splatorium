import { stat, readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { Context, Hono } from 'hono'

export interface StaticFileOptions {
  root: string
}

interface StaticFile {
  bytes: ArrayBuffer
  contentType: string
}

export function registerStaticFiles(app: Hono, options: StaticFileOptions): void {
  const root = resolve(options.root)
  app.get('*', async (c) => serveStaticRequest(c, root))
}

async function serveStaticRequest(c: Context, root: string): Promise<Response> {
  const pathname = new URL(c.req.url).pathname

  if (isApiPath(pathname)) {
    return c.json({ error: 'api route not found' }, 404)
  }

  const requestPath = pathname === '/' ? '/index.html' : pathname
  const staticPath = resolveStaticPath(root, requestPath)
  if (!staticPath) {
    return c.json({ error: 'invalid static path' }, 400)
  }

  const file = await readStaticFile(staticPath)
  if (file) {
    return c.body(file.bytes, 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.bytes.byteLength),
    })
  }

  if (isAssetPath(pathname) || hasFileExtension(pathname)) {
    return c.json({ error: 'static file not found' }, 404)
  }

  const indexPath = resolveStaticPath(root, '/index.html')
  if (!indexPath) {
    throw new Error(`invalid web static root: ${root}`)
  }
  const indexFile = await readStaticFile(indexPath)
  if (!indexFile) {
    // pnpm dev など web ビルド未実施時は 500 ではなく案内付き 404 を返す
    return c.json(
      { error: 'web assets are not built (run: pnpm --filter @splatorium/web build)' },
      404,
    )
  }
  return c.body(indexFile.bytes, 200, {
    'Content-Type': indexFile.contentType,
    'Content-Length': String(indexFile.bytes.byteLength),
  })
}

function resolveStaticPath(root: string, pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }

  if (decoded.includes('\0')) {
    return undefined
  }

  const relativePath = decoded.replace(/^\/+/, '')
  const filePath = resolve(root, relativePath)
  const withinRoot = relative(root, filePath)
  if (withinRoot === '..' || withinRoot.startsWith(`..${separator}`) || isAbsolute(withinRoot)) {
    return undefined
  }

  return filePath
}

async function readStaticFile(filePath: string): Promise<StaticFile | undefined> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      return undefined
    }
    return {
      bytes: toArrayBuffer(await readFile(filePath)),
      contentType: contentTypeFor(filePath),
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }
    throw error
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isAssetPath(pathname: string): boolean {
  return pathname === '/assets' || pathname.startsWith('/assets/')
}

function hasFileExtension(pathname: string): boolean {
  return extname(pathname).length > 0
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return body
}

const separator = process.platform === 'win32' ? '\\' : '/'
