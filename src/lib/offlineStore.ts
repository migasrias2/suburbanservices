// Simple IndexedDB wrapper for draft persistence
const DB_NAME = 'suburban_services'
const DB_VERSION = 1
const DRAFT_STORE = 'work_draft'
const PHOTO_STORE = 'work_photos'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE)
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveDraft(draft: any): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite')
    tx.objectStore(DRAFT_STORE).put(draft, 'active')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getDraft<T = any>(): Promise<T | null> {
  const db = await openDB()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly')
    const req = tx.objectStore(DRAFT_STORE).get('active')
    req.onsuccess = () => resolve((req.result as T) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function clearDraft(): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite')
    tx.objectStore(DRAFT_STORE).delete('active')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function savePhotoBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    tx.objectStore(PHOTO_STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getPhotoBlob(key: string): Promise<Blob | null> {
  const db = await openDB()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const req = tx.objectStore(PHOTO_STORE).get(key)
    req.onsuccess = () => resolve((req.result as Blob) || null)
    req.onerror = () => reject(req.error)
  })
}


