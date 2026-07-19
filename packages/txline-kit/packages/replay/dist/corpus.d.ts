/** Corpus layout: {corpusDir}/{fixtureId}/scores.jsonl + odds.jsonl.
 *  Each line: {"ts": <ms>, "data": <raw record>} sorted ascending by ts. */
export interface CorpusFrame<T = unknown> {
    ts: number;
    data: T;
}
export declare function corpusDirFor(fixtureId: number, corpusDir: string): string;
export declare function writeFrames(file: string, frames: CorpusFrame[]): void;
export declare function readFrames<T = unknown>(file: string): CorpusFrame<T>[];
export declare function defaultCorpusDir(): string;
//# sourceMappingURL=corpus.d.ts.map