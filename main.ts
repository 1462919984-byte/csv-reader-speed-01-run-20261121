// csv-reader-speed-01 entry driver (node22). Reads /input/cases.json, produces
// /output/answers.json. A WebAssembly JSON-to-JSON CSV transducer does the work
// (byte-exact with csv-reader 1.0.0); a pure-JavaScript reader is the fallback.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const { transduce } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  transduce: (input: Buffer) => Buffer;
};

const input = readFileSync(join(INPUT_DIR, 'cases.json'));
const output = transduce(input);
writeFileSync(join(OUTPUT_DIR, 'answers.json'), output);
