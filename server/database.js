import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), ".aindra-data");

function ensureDataDir() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function pathFor(name) {
  ensureDataDir();
  return join(dataDir, name);
}

export function appendEvent(type, payload) {
  const event = {
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    payload,
  };
  appendFileSync(pathFor("events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function saveJson(name, payload) {
  writeFileSync(pathFor(name), JSON.stringify(payload, null, 2), "utf8");
}

export function readJson(name, fallback) {
  try {
    const file = pathFor(name);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

export function readEvents(limit = 200, type = "") {
  try {
    const file = pathFor("events.jsonl");
    if (!existsSync(file)) {
      return [];
    }
    return readFileSync(file, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => !type || event.type === type)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}
