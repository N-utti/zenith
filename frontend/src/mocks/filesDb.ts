/**
 * 업로드된 파일의 목 저장소.
 *
 * 실제 서버라면 오브젝트 스토리지(또는 파일 시스템)에 두고 `/api/files/{id}` 로
 * 내보낼 자리다. 목은 IndexedDB에 넣는다. 메모리에 두면 새로고침 한 번에
 * 문서 속 이미지가 전부 깨지기 때문이다. 대신 이 브라우저 안에서만 보인다.
 */

const DB_NAME = 'zenith.files'
const DB_VERSION = 1
const STORE = 'blobs'

export interface StoredFile {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
  /**
   * 누가 언제 어느 문서에서 올렸는지. 자료실(`archiveDb.ts`)이 읽는다. 이 기록이 생기기 전에
   * 올린 파일에는 없다. 결재 첨부는 남기지 않는다(자료실에 안 실린다).
   */
  doc_id?: string | null
  uploaded_by?: { id: string; name: string }
  created_at?: string
}

type UploadRecord = Pick<StoredFile, 'doc_id' | 'uploaded_by' | 'created_at'>

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

/**
 * 아이디는 무작위여야 한다. 세션마다 1부터 세면, 새로고침 뒤 올린 파일이
 * 아직 문서가 참조 중인 예전 파일을 덮어쓴다.
 *
 * 앞머리는 누구의 파일인지 가른다. `f` 는 문서 이미지(로그인이면 누구나), `a` 는 결재 첨부
 * (문서 열람 권한). 공용 `/api/files` 가 `a` 를 내주면 결재 판정을 건너뛰게 된다.
 */
export async function saveFile(
  file: File,
  prefix: 'f' | 'a' = 'f',
  record: UploadRecord = {},
): Promise<StoredFile> {
  const stored: StoredFile = {
    id: `${prefix}-${crypto.randomUUID()}`,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    ...record,
  }
  await run('readwrite', (store) => store.put(stored))
  return stored
}

/** 올라온 파일 전부. 자료실이 쓴다. */
export function listFiles(): Promise<StoredFile[]> {
  return run('readonly', (store) => store.getAll() as IDBRequest<StoredFile[]>)
}

export function readFile(id: string): Promise<StoredFile | undefined> {
  return run('readonly', (store) => store.get(id) as IDBRequest<StoredFile | undefined>)
}
