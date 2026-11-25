// `orca plugin check` renders the panel once per scenario, with the worker on a fresh host.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  noVault: {},
  missingVault: { storage: { vaults: ['C:\\does-not-exist'] } }
})
