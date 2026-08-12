import type { VirtualFS } from 'almostnode'
import type { VFSSnapshot } from 'almostnode'

const DB_NAME = 'linux-lab-vfs'
const STORE = 'snapshots'
const KEY = 'default'

function hasIndexedDb(): boolean {
	return typeof indexedDB !== 'undefined' && indexedDB !== null
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE)
			}
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
	})
}

/** Persist a VFS snapshot to IndexedDB (survives reload). No-op without IndexedDB (e.g. Bun CLI). */
export async function saveSnapshot(vfs: VirtualFS): Promise<void> {
	if (!hasIndexedDb()) return
	const snapshot = vfs.toSnapshot()
	const db = await openDb()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite')
		tx.objectStore(STORE).put(snapshot, KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error ?? new Error('save failed'))
	})
	db.close()
}

/** Load a VFS snapshot from IndexedDB, or null if none / no IndexedDB. */
export async function loadSnapshot(): Promise<VFSSnapshot | null> {
	if (!hasIndexedDb()) return null
	const db = await openDb()
	const snapshot = await new Promise<VFSSnapshot | null>((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly')
		const req = tx.objectStore(STORE).get(KEY)
		req.onsuccess = () => resolve((req.result as VFSSnapshot) ?? null)
		req.onerror = () => reject(req.error ?? new Error('load failed'))
	})
	db.close()
	return snapshot
}

export async function clearSnapshot(): Promise<void> {
	if (!hasIndexedDb()) return
	const db = await openDb()
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite')
		tx.objectStore(STORE).delete(KEY)
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
	})
	db.close()
}
