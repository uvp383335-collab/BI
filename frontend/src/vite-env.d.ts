/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** 'true' shows the full 21-metric grid; unset/anything else shows only the MVP subset (see CrmDashboardPage). */
  readonly VITE_ENABLE_FULL_METRICS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
