import { describe, it, expect } from "vitest";
import {
  inverseNormalCdf, aPrimeGrier, bDoublePrimeDonaldson, computeSdt,
  MIN_SDT_TRIALS_PER_CLASS, type SdtCells,
} from "./sdt.js";

// Independent anchors first (known values), then the composite is checked for self-consistency
// against those primitives — so a bug in computeSdt cannot hide behind a matching bug in the test.
describe("inverseNormalCdf — known standard-normal quantiles", () => {
  it("matches published z-values", () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 6);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 4);
    expect(inverseNormalCdf(0.025)).toBeCloseTo(-1.959964, 4);
    expect(inverseNormalCdf(0.8413447)).toBeCloseTo(1.0, 4);
    expect(inverseNormalCdf(0.1586553)).toBeCloseTo(-1.0, 4);
  });
  it("is symmetric and monotone", () => {
    expect(inverseNormalCdf(0.3)).toBeCloseTo(-inverseNormalCdf(0.7), 6);
    expect(inverseNormalCdf(0.6)).toBeGreaterThan(inverseNormalCdf(0.4));
  });
});

describe("aPrimeGrier — non-parametric discrimination", () => {
  it("chance performance is 0.5", () => expect(aPrimeGrier(0.5, 0.5)).toBeCloseTo(0.5, 6));
  it("perfect performance is 1.0", () => expect(aPrimeGrier(1, 0)).toBeCloseTo(1, 6));
  it("hand-computed H=0.75, FA=0.25 -> 0.8333", () => expect(aPrimeGrier(0.75, 0.25)).toBeCloseTo(0.833333, 5));
  it("below-chance (H<FA) drops below 0.5", () => expect(aPrimeGrier(0.25, 0.75)).toBeCloseTo(0.166667, 5));
});

describe("bDoublePrimeDonaldson — non-parametric bias sign", () => {
  it("symmetric performance is unbiased (0)", () => expect(bDoublePrimeDonaldson(0.6, 0.4)).toBeCloseTo(0, 6));
  it("high hit + high false-alarm is LIBERAL (negative = over-distrust)", () =>
    expect(bDoublePrimeDonaldson(0.9, 0.5)).toBeLessThan(0));
  it("low hit + low false-alarm is CONSERVATIVE (positive = over-trust)", () =>
    expect(bDoublePrimeDonaldson(0.5, 0.1)).toBeGreaterThan(0));
});

describe("computeSdt — pooled confusion matrix with loglinear correction", () => {
  const good: SdtCells = { hits: 8, misses: 2, falseAlarms: 1, correctRejections: 9 };

  it("applies the +0.5/+1 loglinear correction to the rates", () => {
    const r = computeSdt(good);
    expect(r.hitRate).toBeCloseTo(8.5 / 11, 6);      // (hits+0.5)/(nSignal+1)
    expect(r.falseAlarmRate).toBeCloseTo(1.5 / 11, 6); // (fa+0.5)/(nNoise+1)
  });

  it("d' and c are self-consistent with the primitive z-transform", () => {
    const r = computeSdt(good);
    const zH = inverseNormalCdf(8.5 / 11);
    const zFA = inverseNormalCdf(1.5 / 11);
    expect(r.dPrime).toBeCloseTo(zH - zFA, 6);
    expect(r.c).toBeCloseTo(-0.5 * (zH + zFA), 6);
  });

  it("a good auditor discriminates (A' well above 0.5, d' positive)", () => {
    const r = computeSdt(good);
    expect(r.aPrime).toBeGreaterThan(0.8);
    expect(r.dPrime).toBeGreaterThan(1.5);
    expect(r.varDPrime).toBeGreaterThan(0);
  });

  it("balanced hits/false-alarms give an UNBIASED criterion (c ~ 0)", () => {
    // H = 9.5/11 and FA = 1.5/11 are symmetric about 0.5, so z(H) = -z(FA) -> c = 0.
    const r = computeSdt({ hits: 9, misses: 1, falseAlarms: 1, correctRejections: 9 });
    expect(r.c).toBeCloseTo(0, 6);
  });

  it("over-trust (misses flaws, no false alarms) -> conservative c > 0", () => {
    const r = computeSdt({ hits: 1, misses: 9, falseAlarms: 0, correctRejections: 10 });
    expect(r.c).toBeGreaterThan(0);
  });

  it("over-distrust (flags everything) -> liberal c < 0", () => {
    const r = computeSdt({ hits: 10, misses: 0, falseAlarms: 9, correctRejections: 1 });
    expect(r.c).toBeLessThan(0);
  });

  it("perfect/extreme performance stays FINITE (loglinear kills the z(1)/z(0) blow-up)", () => {
    const r = computeSdt({ hits: 10, misses: 0, falseAlarms: 0, correctRejections: 10 });
    expect(Number.isFinite(r.dPrime)).toBe(true);
    expect(r.dPrime).toBeGreaterThan(3);
  });

  it("sufficiency flag tracks per-class trial counts", () => {
    expect(computeSdt(good).sufficient).toBe(true); // 10 and 10 >= 6
    const thin = computeSdt({ hits: 2, misses: 1, falseAlarms: 0, correctRejections: 2 });
    expect(thin.sufficient).toBe(false);            // 3 and 2 < 6
    expect(thin.trials).toBe(5);
    expect(MIN_SDT_TRIALS_PER_CLASS).toBe(6);
  });
});
