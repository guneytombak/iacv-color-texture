import assert from "node:assert/strict";
import test from "node:test";
import {
  REFERENCE_TEMPERATURE,
  applyGains,
  blackbody,
  deltaE,
  evaluate,
  grayWorldGains,
  greenSpectrum,
  neutralGains,
  surfaceXyz,
  vonKries,
  whitePatchGains,
  whiteXyz,
  xyzToLab,
} from "../app/demos/_lib/constancy.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);

test("exposure gives a perfect white reflector Y = 1 under any light", () => {
  for (const light of [blackbody(2000), blackbody(6500), greenSpectrum()]) close(whiteXyz(light)[1], 1, 1e-12);
  const gray = surfaceXyz(blackbody(4000), blackbody(4000).map(() => 0.36));
  close(gray[1], 0.36, 1e-12, "a flat 36 % reflector");
});

test("CIELAB: the reference white is L* = 100, a* = b* = 0; ΔE is Euclidean", () => {
  const white = whiteXyz(blackbody(REFERENCE_TEMPERATURE));
  const lab = xyzToLab(white, white);
  close(lab[0], 100, 1e-9);
  close(lab[1], 0, 1e-9);
  close(lab[2], 0, 1e-9);
  close(xyzToLab(white.map((value) => value * 0.18), white)[0], 49.496, 0.01, "18 % gray");
  assert.equal(deltaE([50, 10, -10], [53, 14, -10]), 5);
});

test("von Kries maps the light's white exactly onto the reference white", () => {
  const from = whiteXyz(blackbody(2856));
  const to = whiteXyz(blackbody(REFERENCE_TEMPERATURE));
  vonKries(from, from, to).forEach((value, index) => close(value, to[index], 1e-12, `channel ${index}`));
});

test("diagonal estimators do what their assumptions say", () => {
  const neutral = [0.95, 1, 1.09];
  const values = [[0.2, 0.3, 0.1], [0.6, 0.5, 0.2], [0.1, 0.2, 0.4]];
  const grayWorld = values.map((value) => applyGains(value, grayWorldGains(values, neutral)));
  const means = [0, 1, 2].map((channel) => grayWorld.reduce((sum, value) => sum + value[channel], 0) / 3);
  means.forEach((mean, channel) => close(mean / means[1], neutral[channel] / neutral[1], 1e-12, "gray-world mean is neutral"));
  const whitePatch = values.map((value) => applyGains(value, whitePatchGains(values, neutral)));
  [0, 1, 2].forEach((channel) => close(Math.max(...whitePatch.map((value) => value[channel])), neutral[channel], 1e-12, "maxima become the neutral"));
  const chosen = applyGains(values[1], neutralGains(values[1], neutral));
  chosen.forEach((value, channel) => close(value / chosen[1], neutral[channel] / neutral[1], 1e-12, "chosen sample is neutral"));
  close(chosen[1], values[1][1], 1e-12, "second channel kept");
});

test("no correction is exact under the reference light; a known light beats no correction under tungsten", () => {
  close(evaluate(blackbody(REFERENCE_TEMPERATURE), "none", 0).meanError, 0, 1e-9);
  const tungsten = blackbody(2856);
  const none = evaluate(tungsten, "none", 0).meanError;
  const known = evaluate(tungsten, "vonKries", 0).meanError;
  assert.ok(none > 30 && known < none / 4, `none ${none}, known ${known}`);
  // Choosing the white patch (index 18) as neutral is exact for that patch.
  close(evaluate(tungsten, "manual", 18).errors[18], 0, 1e-9);
});
