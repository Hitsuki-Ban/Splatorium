import type { Asset, Job } from '@splatorium/shared'
import type { WorkbenchStore } from './store.js'
import type { WorkbenchEventHub } from './workbench-events.js'

/** The sole production mutation boundary: persist first, then enqueue its event. */
export function createObservableWorkbenchStore(
  store: WorkbenchStore,
  events: Pick<WorkbenchEventHub, 'publishAsset' | 'publishAssetDeleted' | 'publishJob'>,
): WorkbenchStore {
  return {
    saveAsset(asset: Asset) {
      store.saveAsset(asset)
      events.publishAsset(asset)
    },
    getAsset(id) {
      return store.getAsset(id)
    },
    listAssets() {
      return store.listAssets()
    },
    deleteAsset(id) {
      const deleted = store.deleteAsset(id)
      if (deleted) events.publishAssetDeleted(id)
      return deleted
    },
    saveJob(job: Job) {
      store.saveJob(job)
      events.publishJob(job)
    },
    getJob(id) {
      return store.getJob(id)
    },
    listJobs(options) {
      return store.listJobs(options)
    },
    close() {
      store.close()
    },
  }
}
