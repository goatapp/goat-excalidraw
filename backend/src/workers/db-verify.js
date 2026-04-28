import { parentPort, workerData } from "worker_threads";

if (!parentPort) throw new Error("Must be run in a worker thread");

const openReadonlyDb = async (filePath) => {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(filePath, {
      readOnly: true,
      enableForeignKeyConstraints: false,
    });
    return { kind: "node:sqlite", db };
  } catch (_err) {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    return { kind: "better-sqlite3", db };
  }
};

try {
  const { filePath } = workerData;
  const { db } = await openReadonlyDb(filePath);

  const result = db.prepare("PRAGMA integrity_check;").get();

  db.close();
  parentPort.postMessage(result.integrity_check === "ok");
} catch (error) {
  parentPort.postMessage(false);
}
