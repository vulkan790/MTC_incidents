// Работа с файлами данных: атомарная запись и безопасное чтение.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(here, '..', 'data');

export const FILES = {
  incidents: path.join(DATA_DIR, 'incidents.json'),
  mail: path.join(DATA_DIR, 'mail.json'),
  dashboard: path.join(DATA_DIR, 'dashboard-state.json'),
  source: path.join(DATA_DIR, 'source', 'character_problems.json'),
};

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// Изменение файла инцидентов «как будто это сделала ITSM»: читаем, меняем, пишем.
export function updateIncidents(mutator) {
  const list = readJson(FILES.incidents);
  const result = mutator(list);
  writeJson(FILES.incidents, list);
  return result;
}

export function updateMail(mutator) {
  const list = readJson(FILES.mail, []);
  const result = mutator(list);
  writeJson(FILES.mail, list);
  return result;
}
