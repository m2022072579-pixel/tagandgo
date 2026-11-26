import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Keep the existing shared domain representation while making each write a SQLite transaction.
export function openStore(path, legacyPath, initialState) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  database.exec("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), schema_version INTEGER NOT NULL, body TEXT NOT NULL CHECK (json_valid(body)))");
  const select = database.prepare("SELECT body FROM app_state WHERE id = 1");
  const write = database.prepare("INSERT INTO app_state (id, schema_version, body) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body");

  database.exec("BEGIN IMMEDIATE");
  try {
    if (!select.get()) {
      let state = initialState();
      try {
        const imported = JSON.parse(readFileSync(legacyPath, "utf8"));
        if (!imported || typeof imported !== "object" || Array.isArray(imported) || !imported.members || !imported.tags) throw new Error("기존 데이터 형식을 확인해 주세요.");
        state = { ...state, ...imported };
      }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      write.run(JSON.stringify(state));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }

  return {
    read() { return JSON.parse(select.get().body); },
    update(operation) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const next = JSON.parse(select.get().body);
        const result = operation(next);
        write.run(JSON.stringify(next));
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() { database.close(); },
  };
}
