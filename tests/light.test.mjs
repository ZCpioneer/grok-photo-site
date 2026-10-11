import assert from "node:assert/strict";
import test from "node:test";
import { mixRooms, onRoom, roomHexFromPixels, UNDEVELOPED } from "../site/light.js";

function field(hex, count = 16) {
  const n = parseInt(hex.slice(1), 16);
  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    rgba[i * 4] = (n >> 16) & 255;
    rgba[i * 4 + 1] = (n >> 8) & 255;
    rgba[i * 4 + 2] = n & 255;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test("a photo room is muted and a drawing room keeps a light edge", () => {
  const photo = roomHexFromPixels(field("#ffffff"));
  const drawing = roomHexFromPixels(field("#ffffff"), { drawing: true });
  assert.match(photo, /^#[0-9a-f]{6}$/);
  assert.equal(onRoom(photo), "#f2f0ea");
  assert.equal(onRoom(drawing), "#282923");
  assert.equal(onRoom(roomHexFromPixels(field("#000000"))), "#f2f0ea");
});

test("the same pixels always return the same room", () => {
  const pixels = field("#34566d");
  assert.equal(roomHexFromPixels(pixels), roomHexFromPixels(pixels));
});

test("an empty sample and the undeveloped room stay dark", () => {
  assert.equal(UNDEVELOPED, "#3e3f3c");
  assert.equal(onRoom(UNDEVELOPED), "#f2f0ea");
  assert.equal(roomHexFromPixels(new Uint8ClampedArray(0)), UNDEVELOPED);
});

test("a running drop mixes toward one room", () => {
  const one = mixRooms([[0.8, 0.01, -0.02]]);
  const two = mixRooms([[0.8, 0.01, -0.02], [0.2, -0.01, 0.02]]);
  assert.match(one.trip, /^#[0-9a-f]{6}$/);
  assert.match(one.room, /^#[0-9a-f]{6}$/);
  assert.notEqual(one.room, two.room);
  assert.equal(mixRooms([]).room, UNDEVELOPED);
});
