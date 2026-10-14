const DB = "shigodeki-drafts-v1";
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function draft(action, userId, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "drafts",
        action === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const request =
        action === "put"
          ? store.put(value, userId)
          : action === "delete"
            ? store.delete(userId)
            : store.get(userId);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || new Error("端末への保存に失敗しました。"));
    });
  } finally {
    db.close();
  }
}
