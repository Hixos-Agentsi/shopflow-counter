import assert from "node:assert/strict";
import { CrossingTracker, computeLineCoordinate } from "../js/tracker.js";

function crossing(points, entryDirection = "negative-to-positive") {
  const tracker = new CrossingTracker({
    maxDistance: 300,
    cooldownMs: 0,
    hysteresis: 5,
  });
  let now = 10_000;
  const events = [];
  for (const point of points) {
    const result = tracker.update([point], now, {
      orientation: "horizontal",
      lineCoordinate: 100,
      entryDirection,
    });
    events.push(...result.events);
    now += 100;
  }
  return events;
}

assert.equal(computeLineCoordinate("horizontal", 50, 1280, 720), 360);
assert.equal(computeLineCoordinate("vertical", 25, 1280, 720), 320);

const entryEvents = crossing([
  { x: 50, y: 60 },
  { x: 52, y: 90 },
  { x: 54, y: 104 },
  { x: 56, y: 130 },
]);
assert.equal(entryEvents.length, 1);
assert.equal(entryEvents[0].type, "entry");

const exitEvents = crossing([
  { x: 50, y: 140 },
  { x: 52, y: 104 },
  { x: 54, y: 90 },
  { x: 56, y: 60 },
]);
assert.equal(exitEvents.length, 1);
assert.equal(exitEvents[0].type, "exit");

const invertedEvents = crossing([
  { x: 50, y: 140 },
  { x: 52, y: 80 },
], "positive-to-negative");
assert.equal(invertedEvents.length, 1);
assert.equal(invertedEvents[0].type, "entry");

const noCrossingEvents = crossing([
  { x: 50, y: 60 },
  { x: 52, y: 70 },
  { x: 54, y: 80 },
]);
assert.equal(noCrossingEvents.length, 0);

const multiTracker = new CrossingTracker({ maxDistance: 160, cooldownMs: 0, hysteresis: 5 });
multiTracker.update(
  [{ x: 100, y: 50 }, { x: 400, y: 55 }],
  20_000,
  { orientation: "horizontal", lineCoordinate: 100, entryDirection: "negative-to-positive" },
);
const multiResult = multiTracker.update(
  [{ x: 105, y: 140 }, { x: 405, y: 145 }],
  20_200,
  { orientation: "horizontal", lineCoordinate: 100, entryDirection: "negative-to-positive" },
);
assert.equal(multiResult.events.length, 2);
assert.ok(multiResult.events.every((event) => event.type === "entry"));

const verticalTracker = new CrossingTracker({ maxDistance: 200, cooldownMs: 0, hysteresis: 5 });
verticalTracker.update(
  [{ x: 40, y: 80 }],
  30_000,
  { orientation: "vertical", lineCoordinate: 100, entryDirection: "negative-to-positive" },
);
const verticalResult = verticalTracker.update(
  [{ x: 160, y: 82 }],
  30_200,
  { orientation: "vertical", lineCoordinate: 100, entryDirection: "negative-to-positive" },
);
assert.equal(verticalResult.events.length, 1);
assert.equal(verticalResult.events[0].type, "entry");

console.log("Tracker tests: OK");

// A visitor appearing after timeout must not inherit the previous visitor's side.
const stale = new CrossingTracker({maxAgeMs: 500});
const cfg = {orientation:'vertical', lineCoordinate:100, entryDirection:'negative-to-positive'};
stale.update([{x:70,y:100}],0,cfg);
assert.equal(stale.update([{x:140,y:100}],1000,cfg).events.length,0);
// Jitter inside the hysteresis band is not a crossing.
assert.equal(crossing([{x:50,y:80},{x:50,y:99},{x:50,y:101},{x:50,y:98}]).length,0);
console.log('Timeout and jitter regression tests: OK');
