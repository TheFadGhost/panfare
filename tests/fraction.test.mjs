import { describe, it, expect } from "vitest";
import {
  makeFraction as F,
  add, sub, mul, div, cmp, eq, lt, gt, neg, abs,
  fromDecimalString, fromString, floorFrac, nearestWithDenominator,
  ZERO, ONE,
  FractionOverflowError, DivisionByZeroError, MalformedFractionError,
} from "../src/core/fraction.mjs";

describe("construction & reduction", () => {
  it("reduces to lowest terms", () => {
    expect(F(4, 8)).toEqual({ n: 1, d: 2 });
    expect(F(100, 25)).toEqual({ n: 4, d: 1 });
  });
  it("normalises negative denominators onto the numerator", () => {
    expect(F(1, -2)).toEqual({ n: -1, d: 2 });
    expect(F(-1, -2)).toEqual({ n: 1, d: 2 });
  });
  it("rejects zero denominators and non-integers", () => {
    expect(() => F(1, 0)).toThrow(DivisionByZeroError);
    expect(() => F(0.5, 1)).toThrow(MalformedFractionError);
    expect(() => F(1, 0.5)).toThrow(MalformedFractionError);
  });
});

describe("exact arithmetic — no floating point anywhere", () => {
  it("makes 1/3 x 3 exactly 1", () => {
    const third = F(1, 3);
    expect(eq(mul(third, F(3)), ONE)).toBe(true);
    expect(eq(add(add(third, third), third), ONE)).toBe(true);
  });
  it("makes 1/8 x 8 exactly 1", () => {
    expect(eq(mul(F(1, 8), F(8)), ONE)).toBe(true);
  });
  it("round-trips repeated scaling exactly (x 7/3 then x 3/7)", () => {
    const q = F(2, 3);
    const scaled = mul(q, F(7, 3));
    expect(eq(mul(scaled, F(3, 7)), q)).toBe(true);
  });
  it("round-trips a long chain of scale factors exactly", () => {
    let q = F(3, 4);
    for (const k of [F(2), F(1, 3), F(9, 5), F(11, 7), F(1, 2)]) {
      q = mul(q, k);
    }
    // undo in reverse order
    for (const k of [F(2), F(7, 11), F(5, 9), F(3), F(1, 2)]) {
      q = mul(q, k);
    }
    expect(eq(q, F(3, 4))).toBe(true);
  });
  it("adds thirds without drift", () => {
    const t = F(1, 3);
    expect(eq(add(t, add(t, t)), ONE)).toBe(true);
  });
  it("subtracts below zero and keeps signs straight", () => {
    expect(sub(F(1, 4), F(1, 2))).toEqual({ n: -1, d: 4 });
    expect(eq(neg(sub(F(1, 2), F(3, 2))), ONE)).toBe(true);
  });
  it("divides exactly", () => {
    expect(div(F(1, 2), F(1, 4))).toEqual({ n: 2, d: 1 });
    expect(() => div(ONE, ZERO)).toThrow(DivisionByZeroError);
  });
  it("compares by cross multiplication only", () => {
    expect(cmp(F(1, 3), F(1, 2))).toBe(-1);
    expect(gt(F(3, 8), F(1, 3))).toBe(true);
    expect(lt(F(2, 7), F(1, 3))).toBe(true);
    expect(eq(F(2, 6), F(1, 3))).toBe(true);
  });
  it("abs and neg behave", () => {
    expect(abs(F(-3, 4))).toEqual({ n: 3, d: 4 });
  });
});

describe("parsing textual numbers exactly", () => {
  it("parses decimals into exact rationals", () => {
    expect(fromDecimalString("0.75")).toEqual({ n: 3, d: 4 });
    expect(fromDecimalString("-1.5")).toEqual({ n: -3, d: 2 });
    expect(fromDecimalString("2")).toEqual({ n: 2, d: 1 });
  });
  it("never loses precision on finite decimals", () => {
    // 0.1 in binary floats is not 0.1; here it must be exactly 1/10
    expect(fromDecimalString("0.1")).toEqual({ n: 1, d: 10 });
  });
  it("rejects malformed input", () => {
    expect(() => fromDecimalString("abc")).toThrow(MalformedFractionError);
    expect(() => fromDecimalString("")).toThrow(MalformedFractionError);
  });
  it("parses slash fractions", () => {
    expect(fromString("3/4")).toEqual({ n: 3, d: 4 });
    expect(fromString("2 / 8")).toEqual({ n: 1, d: 4 });
  });
});

describe("overflow protection", () => {
  it("throws instead of drifting past safe integers", () => {
    const big = { n: Number.MAX_SAFE_INTEGER, d: 1 };
    expect(() => mul(big, big)).toThrow(FractionOverflowError);
  });
});

describe("helpers", () => {
  it("floorFrac splits whole and proper remainder", () => {
    expect(floorFrac(F(7, 2))).toEqual({ whole: 3, rest: { n: 1, d: 2 } });
    expect(floorFrac(F(4, 2))).toEqual({ whole: 2, rest: { n: 0, d: 1 } });
    expect(() => floorFrac(F(-1, 2))).toThrow(MalformedFractionError);
  });
  it("nearestWithDenominator finds exact friendly fractions", () => {
    const r = nearestWithDenominator(F(1, 3), 8);
    expect(r.value).toEqual({ n: 1, d: 3 });
    expect(r.approx).toBe(false);
  });
  it("nearestWithDenominator marks approximations honestly", () => {
    const r = nearestWithDenominator(F(1177, 9000), 8); // ~0.13078 -> 1/8 = 0.125
    expect(r.approx).toBe(true);
    expect(r.value.d <= 8).toBe(true);
  });
});
