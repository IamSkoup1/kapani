import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getDatabase, ref, set, get, update, push, remove, onValue, off, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { CONFIG } from "./config.js";

const app = initializeApp(CONFIG.firebase);
const db = getDatabase(app);
const storage = getStorage(app);

export { db, storage, ref, set, get, update, push, remove, onValue, off, runTransaction, serverTimestamp, sRef, uploadBytes, getDownloadURL };

export function dbRef(path) {
    return ref(db, path);
}

export async function dbGet(path) {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
}

export async function dbSet(path, value) {
    return set(ref(db, path), value);
}

export async function dbUpdate(path, value) {
    return update(ref(db, path), value);
}

export async function dbPush(path, value) {
    return push(ref(db, path), value);
}

export async function dbRemove(path) {
    return remove(ref(db, path));
}

export function dbOnValue(path, callback) {
    const r = ref(db, path);
    onValue(r, (snap) => {
        callback(snap.exists() ? snap.val() : null, snap);
    });
    return () => off(r);
}

export async function uploadFile(path, file) {
    try {
        const fileRef = sRef(storage, path);
        const snapshot = await uploadBytes(fileRef, file);
        const url = await getDownloadURL(snapshot.ref);
        return url;
    } catch (e) {
        console.warn("Storage upload failed, fallback to base64/URL", e);
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
    }
}
