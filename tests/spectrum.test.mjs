import assert from "node:assert/strict";
import test from "node:test";
import {
  angularProfile,
  inWedge,
  polarPower,
  radialProfile,
  ringFraction,
  signedFrequency,
  wedgeFraction,
  windowedSpectrum,
} from "../app/demos/_lib/spectrum.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);

function grating(size, frequency, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const fu = frequency * Math.cos(radians);
  const fv = frequency * Math.sin(radians);
  return Float64Array.from({ length: size * size }, (_, index) => 128 + 90 * Math.cos(2 * Math.PI * (fu * (index % size) + fv * Math.floor(index / size))));
}

test("signed DFT frequencies run from −1/2 to just below 1/2", () => {
  assert.equal(signedFrequency(0, 8), 0);
  assert.equal(signedFrequency(3, 8), 3 / 8);
  assert.equal(signedFrequency(4, 8), -4 / 8);
  assert.equal(signedFrequency(7, 8), -1 / 8);
});

test("a grating's power falls in the ring at its frequency and the wedge at its direction (y downward)", () => {
  const polar = polarPower(windowedSpectrum(grating(128, 0.2, 60), 128).spectrum);
  assert.ok(ringFraction(polar, 0.17, 0.23) > 0.95, "ring");
  assert.ok(wedgeFraction(polar, 55, 65) > 0.9, "wedge");
  assert.ok(wedgeFraction(polar, 115, 125) < 0.01, "mirror direction stays empty");
  // 60° lies on a band edge; a grating at the centre of the 60°–65° band must peak in that band.
  const angular = angularProfile(polarPower(windowedSpectrum(grating(128, 0.2, 62.5), 128).spectrum), 36);
  assert.equal(angular.indexOf(Math.max(...angular)), 12, "strongest band is 60°–65°");
});

test("complementary rings and wedges partition the non-DC power", () => {
  const values = Float64Array.from({ length: 64 * 64 }, (_, index) => ((index * 2654435761) % 1013) / 3);
  const polar = polarPower(windowedSpectrum(values, 64).spectrum);
  close(ringFraction(polar, 0, 0.12) + ringFraction(polar, 0.12, 1), 1, 1e-12, "rings");
  close(wedgeFraction(polar, 10, 170) + wedgeFraction(polar, 170, 10), 1, 1e-12, "wedges with wrap-around");
  close(radialProfile(polar, 20, 1).reduce((sum, value) => sum + value, 0), 1, 1e-12, "radial profile over the full square");
  close(angularProfile(polar, 36).reduce((sum, value) => sum + value, 0), 1, 1e-12, "angular profile");
});

test("wedge membership folds angles and wraps through 180°", () => {
  assert.ok(inWedge(175, 170, 10));
  assert.ok(inWedge(5, 170, 10));
  assert.ok(!inWedge(90, 170, 10));
  assert.ok(inWedge(80, 75, 105));
  assert.ok(!inWedge(105, 75, 105));
});

test("the DC bin is excluded and power is centrally symmetric", () => {
  const values = Float64Array.from({ length: 32 * 32 }, (_, index) => 50 + ((index * 7919) % 97));
  const { spectrum } = windowedSpectrum(values, 32);
  const polar = polarPower(spectrum);
  assert.equal(polar.power[0], 0);
  for (const [k, l] of [[3, 5], [10, 1], [31, 17]]) {
    close(polar.power[l * 32 + k], polar.power[((32 - l) % 32) * 32 + ((32 - k) % 32)], 1e-6 * polar.total, `P(${k},${l})`);
  }
});
