import * as fs from "node:fs";
import * as path from "node:path";

/** Corpus layout: {corpusDir}/{fixtureId}/scores.jsonl + odds.jsonl.
 *  Each line: {"ts": <ms>, "data": <raw record>} sorted ascending by ts. */

export interface CorpusFrame<T = unknown> {
  ts: number;
  data: T;
}

export function corpusDirFor(fixtureId: number, corpusDir: string): string {
  return path.join(corpusDir, String(fixtureId));
}

export function writeFrames(file: string, frames: CorpusFrame[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = [...frames].sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(file, sorted.map((f) => JSON.stringify(f)).join("\n") + "\n");
}

export function readFrames<T = unknown>(file: string): CorpusFrame<T>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CorpusFrame<T>)
    .sort((a, b) => a.ts - b.ts);
}

export function defaultCorpusDir(): string {
  return process.env.CORPUS_DIR ?? path.resolve(process.cwd(), "..", "corpus");
}
