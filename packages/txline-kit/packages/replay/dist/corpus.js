import * as fs from "node:fs";
import * as path from "node:path";
export function corpusDirFor(fixtureId, corpusDir) {
    return path.join(corpusDir, String(fixtureId));
}
export function writeFrames(file, frames) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sorted = [...frames].sort((a, b) => a.ts - b.ts);
    fs.writeFileSync(file, sorted.map((f) => JSON.stringify(f)).join("\n") + "\n");
}
export function readFrames(file) {
    if (!fs.existsSync(file))
        return [];
    return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .sort((a, b) => a.ts - b.ts);
}
export function defaultCorpusDir() {
    return process.env.CORPUS_DIR ?? path.resolve(process.cwd(), "..", "corpus");
}
//# sourceMappingURL=corpus.js.map