// Regenerate the A4 one-sheet PDF: node docs/onesheet/render.mjs
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file://' + join(here, 'splatorium-onesheet.html').replaceAll('\\', '/'))
await page.pdf({
  path: join(here, '..', 'splatorium-onesheet.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
})
await browser.close()
console.log('generated docs/splatorium-onesheet.pdf')
