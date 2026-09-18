import assert from 'node:assert/strict';
import { CrossingTracker, computeLineCoordinate } from '../js/tracker.js';

assert.equal(computeLineCoordinate('horizontal', 50, 1280, 720), 360);
assert.equal(computeLineCoordinate('vertical', 25, 1280, 720), 320);

for (const orientation of ['vertical', 'horizontal']) {
  for (const entryDirection of ['negative-to-positive', 'positive-to-negative']) {
    const tracker = new CrossingTracker({maxDistance:300, hysteresis:5});
    const cfg = {orientation, lineCoordinate:100, entryDirection};
    const box = (p, other=50) => orientation === 'vertical'
      ? {x:p,y:other,width:40,height:60}
      : {x:other,y:p,width:60,height:40};
    let now=10000;
    const step = (p) => tracker.update([box(p)],now+=100,cfg).events;
    const positiveType = entryDirection === 'negative-to-positive' ? 'entry' : 'exit';
    const negativeType = positiveType === 'entry' ? 'exit' : 'entry';

    assert.equal(step(50).length,0,'initial rectangle wholly before line');
    for (const p of [70,85,75,90,80,100,104,105]) {
      assert.equal(step(p).length,0,'partial crossing, centre oscillation, contact and tolerance must not count');
    }
    let events=step(106);
    assert.equal(events.length,1,'count exactly once when trailing edge clears line + tolerance');
    assert.equal(events[0].type,positiveType);
    for (const p of [108,110,80,100,110]) {
      assert.equal(step(p).length,0,'staying beyond line or partial return cannot count again');
    }
    events=step(50);
    assert.equal(events.length,1,'full reverse crossing counts');
    assert.equal(events[0].type,negativeType);
    assert.equal(step(106)[0].type,positiveType,'a fast full return must also count');

    tracker.reset();
    assert.equal(step(50).length,0);
    assert.equal(step(90).length,0);
    assert.equal(step(50).length,0,'partial crossing followed by retreat produces no event');

    tracker.reset();
    assert.equal(step(80).length,0);
    assert.equal(step(106).length,0,'starting astride line provides no known origin');
    assert.equal(step(50).length,1,'next full crossing now has a known origin');

    tracker.reset();
    tracker.update([box(50),box(50,450)],now+=100,cfg);
    events=tracker.update([box(106),box(106,450)],now+=100,cfg).events;
    assert.equal(events.length,2,'two separated people cross independently');
    assert.ok(events.every(e=>e.type===positiveType));

    tracker.reset();
    tracker.update([box(50)],now+=100,cfg);
    assert.equal(tracker.update([box(106)],now+=2000,cfg).events.length,0,'expired person must not be matched');
    tracker.reset();
    assert.equal(tracker.update([{x:50,y:50}],now+=100,cfg).tracks.length,0,'no fallback to a point when rectangle missing');
  }
}
console.log('Full rectangle tests: both axes/directions, partial/complete/reverse crossing, oscillations, overlap origin, multiple people and expiry OK');
