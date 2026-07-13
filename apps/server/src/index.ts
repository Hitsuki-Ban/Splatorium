import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createServerApp } from './app.js'
import { createComfyUiClient } from './comfy-client.js'
import { createImageToSplatRunner } from './comfy-runner.js'
import { loadServerConfig } from './config.js'
import { JobQueue } from './job-queue.js'
import { recoverInterruptedJobs } from './job-recovery.js'
import { createModelPreflight } from './model-preflight.js'
import { createObservableWorkbenchStore } from './observable-store.js'
import { createSqliteStore } from './store.js'
import { WorkbenchEventHub } from './workbench-events.js'
import type { ApiWorkflow } from './workflow.js'

const config = loadServerConfig()
const baseWorkflow = JSON.parse(await readFile(config.workflowPath, 'utf8')) as ApiWorkflow
const events = new WorkbenchEventHub()
const store = createObservableWorkbenchStore(
  createSqliteStore({ dataDir: config.dataDir }),
  events,
)
const comfyClient = createComfyUiClient({ baseUrl: config.comfyUiUrl })
const modelPreflight =
  config.modelManifestPath && config.comfyUiRoot
    ? createModelPreflight({
        manifestPath: config.modelManifestPath,
        comfyUiRoot: config.comfyUiRoot,
      })
    : undefined
const runJob = createImageToSplatRunner({
  dataDir: config.dataDir,
  store,
  baseWorkflow,
  comfyClient,
  modelPreflight,
})
const queue = new JobQueue({
  store,
  runJob,
})
recoverInterruptedJobs({ store, queue })
const app = createServerApp({
  dataDir: config.dataDir,
  store,
  queue,
  events,
  staticDir: config.webStaticDir,
})

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Splatorium server: http://localhost:${info.port}`)
  console.log(`ComfyUI endpoint: ${config.comfyUiUrl}`)
  console.log(`Data directory: ${config.dataDir}`)
  console.log(`Web static directory: ${config.webStaticDir}`)
  if (config.modelManifestPath && config.comfyUiRoot) {
    console.log(`Model manifest: ${config.modelManifestPath}`)
    console.log(`ComfyUI root: ${config.comfyUiRoot}`)
  }
})

process.on('SIGINT', () => {
  store.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  store.close()
  process.exit(0)
})
