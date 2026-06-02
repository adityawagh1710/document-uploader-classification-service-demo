import fc from "fast-check";
import type { CLSID } from "../../../src/shared/types.js";

const hex = (length: number): fc.Arbitrary<string> =>
  fc.array(fc.integer({ min: 0, max: 15 }), { minLength: length, maxLength: length })
    .map((digits) => digits.map((d) => d.toString(16).toUpperCase()).join(""));

export const validCLSIDGen: fc.Arbitrary<CLSID> = fc
  .tuple(hex(8), hex(4), hex(4), hex(4), hex(12))
  .map(([g1, g2, g3, g4, g5]) => `${g1}-${g2}-${g3}-${g4}-${g5}`);
