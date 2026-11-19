import { closeDb, migrate, redact } from "../db.js";

try {
  await migrate();
  console.log("Миграции применены.");
} catch (error) {
  console.error(error.publicMessage || `Миграция не выполнена. ${redact(error)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
