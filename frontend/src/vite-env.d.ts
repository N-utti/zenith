/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true'로 두면 MSW를 끄고 vite 프록시를 통해 실제 FastAPI(:8000)에 붙는다. */
  readonly VITE_DISABLE_MSW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
