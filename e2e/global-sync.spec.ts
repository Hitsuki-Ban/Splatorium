import { expect, test } from '@playwright/test'

test('syncs scene assets across two clients and repairs after reconnect', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  await contextB.addInitScript(() => {
    const NativeEventSource = window.EventSource
    class ControllableEventSource {
      static readonly CONNECTING = NativeEventSource.CONNECTING
      static readonly OPEN = NativeEventSource.OPEN
      static readonly CLOSED = NativeEventSource.CLOSED
      readonly CONNECTING = NativeEventSource.CONNECTING
      readonly OPEN = NativeEventSource.OPEN
      readonly CLOSED = NativeEventSource.CLOSED
      readonly url: string
      readonly withCredentials: boolean
      readyState = NativeEventSource.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      private source: EventSource | null = null

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = String(url)
        this.withCredentials = init?.withCredentials ?? false
        this.connect()
        ;(window as Window & { __workbenchEventSource?: ControllableEventSource })
          .__workbenchEventSource = this
      }

      connect(): void {
        this.source?.close()
        const source = new NativeEventSource(this.url, { withCredentials: this.withCredentials })
        this.source = source
        this.readyState = NativeEventSource.CONNECTING
        source.onopen = (event) => {
          this.readyState = NativeEventSource.OPEN
          this.onopen?.(event)
        }
        source.onmessage = (event) => this.onmessage?.(event)
        source.onerror = (event) => this.onerror?.(event)
      }

      disconnectForTest(): void {
        this.source?.close()
        this.source = null
        this.readyState = NativeEventSource.CONNECTING
        this.onerror?.(new Event('error'))
      }

      close(): void {
        this.source?.close()
        this.source = null
        this.readyState = NativeEventSource.CLOSED
      }
    }
    window.EventSource = ControllableEventSource as unknown as typeof EventSource
  })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await Promise.all([pageA.goto('/'), pageB.goto('/')])
    await expect(pageA.getByText('server: ok')).toBeVisible()
    await expect(pageB.getByText('server: ok')).toBeVisible()

    await pageA.getByRole('button', { name: 'グループを作成' }).click()
    await pageA.getByRole('textbox', { name: 'シーン名' }).fill('共有シーン')
    await pageA.getByRole('button', { name: '保存' }).click()
    await expect(pageA.getByText(/「共有シーン」を倉庫に保存しました/)).toBeVisible()

    await pageB.getByRole('radio', { name: /^シーン/ }).click()
    await expect(pageB.getByText('共有シーン', { exact: true })).toBeVisible()

    await pageB.evaluate(() => {
      const source = (window as Window & {
        __workbenchEventSource: { disconnectForTest(): void }
      }).__workbenchEventSource
      source.disconnectForTest()
    })
    await expect(pageB.getByText(/生成 API に接続できません/)).toBeVisible()
    await pageA.getByRole('textbox', { name: 'シーン名' }).fill('再接続後のシーン')
    await pageA.getByRole('button', { name: '上書き保存' }).click()
    await expect(pageA.getByText(/「再接続後のシーン」を倉庫に保存しました/)).toBeVisible()
    await expect(pageB.getByText('共有シーン', { exact: true })).toBeVisible()

    await pageB.evaluate(() => {
      const source = (window as Window & {
        __workbenchEventSource: { connect(): void }
      }).__workbenchEventSource
      source.connect()
    })
    await expect(pageB.getByText('再接続後のシーン', { exact: true })).toBeVisible()
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
