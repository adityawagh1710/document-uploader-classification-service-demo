import { bench, describe } from "vitest";
import { createOLE2Parser } from "../../src/domain/tier2-ole2/index.js";
import { createScorer } from "../../src/domain/scoring/index.js";
import { createCategoryMapper } from "../../src/domain/categories/index.js";
import { createSlipsheetDecider } from "../../src/domain/slipsheet/index.js";
import { createTier3TextDetector } from "../../src/domain/tier3-text/index.js";
import { buildOLE2Buffer } from "../pbt/generators/ole2.gen.js";
import type { CLSID } from "../../src/shared/types.js";

const docCLSID: CLSID = "00020906-0000-0000-C000-000000000046";
const ole2Buffer = buildOLE2Buffer({ clsid: docCLSID });
const textBuffer = new TextEncoder().encode("<?xml version=\"1.0\"?><root/>");
const csvBuffer = new TextEncoder().encode("a,b,c\nd,e,f\ng,h,i\n");

describe("U-1 classifier-core perf", () => {
  const parser = createOLE2Parser();
  const scorer = createScorer();
  const mapper = createCategoryMapper();
  const decider = createSlipsheetDecider();
  const textDetector = createTier3TextDetector();

  bench("OLE2Parser.parseCLSID (valid doc CLSID)", () => {
    parser.parseCLSID(ole2Buffer);
  }, { iterations: 200 });

  bench("Tier3TextDetector.detect (XML)", () => {
    textDetector.detect(textBuffer);
  }, { iterations: 200 });

  bench("Tier3TextDetector.detect (CSV)", () => {
    textDetector.detect(csvBuffer);
  }, { iterations: 200 });

  bench("Scorer.score (corroborating modifiers)", () => {
    scorer.score({ matchType: "ole2-with-clsid", detectedFormat: "doc", extension: "doc", contentType: "application/msword" });
  }, { iterations: 200 });

  bench("CategoryMapper.map (doc via OLE2)", () => {
    mapper.map("doc", "ole2-clsid");
  }, { iterations: 200 });

  bench("SlipsheetDecider.decide (no slipsheet)", () => {
    decider.decide({
      score: 0.9,
      threshold: 0.5,
      detectedFormat: "docx",
      parentArchiveDepth: 0,
      maxZipDepth: 5,
      quarantineMacros: false,
      slipsheetRules: {},
    });
  }, { iterations: 200 });
});
