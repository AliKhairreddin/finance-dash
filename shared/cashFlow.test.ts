import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCashFlowAmount } from "./cashFlow";

test("cash-flow arithmetic respects precedence, parentheses, signs, and cent rounding", () => {
  for (const [input, value] of [["=1000+250-50",1200],["=(100+20)*2",240],["=100/4+3*2",31],["=-100+25",-75],["12.345",12.35],["=0.1+0.2",0.3],["=10/-2",-5]] as const) assert.equal(evaluateCashFlowAmount(input),value);
});
test("cash-flow formulas cannot execute code or save incomplete/non-finite calculations", () => {
  for(const input of ["", "=", "=1+", "=1/0", "=Math.random()", "=alert(1)", "=1;2", "=(1+2", "=1 2", "=2(3)", "=99999999999999999999999", "="+"1+".repeat(130)]) assert.throws(() => evaluateCashFlowAmount(input),input);
});
