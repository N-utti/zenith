/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true'로 두면 MSW를 끄고 vite 프록시를 통해 실제 FastAPI(:8000)에 붙는다. */
  readonly VITE_DISABLE_MSW?: string
  /** 'true'면 운영 빌드여도 MSW 로 돈다. 사외 시연판(`npm run demo`)용. */
  readonly VITE_DEMO?: string
  /**
   * 앱이 붙을 사내 서버 오리진 (예: `https://zenith.example.co.kr`).
   * 비워 두면 같은 오리진으로 나간다. 데스크탑 셸 빌드에서는 반드시 채워야 한다.
   */
  readonly VITE_SERVER_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
