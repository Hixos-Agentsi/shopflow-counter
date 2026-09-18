const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function stableSide(box, orientation, lineCoordinate, hysteresis) {
  const nearEdge = orientation === "horizontal" ? box.y : box.x;
  const farEdge = nearEdge + (orientation === "horizontal" ? box.height : box.width);
  // A box straddling or touching the line never establishes a new side.
  if (farEdge < lineCoordinate - hysteresis) return -1;
  if (nearEdge > lineCoordinate + hysteresis) return 1;
  return 0;
}

/**
 * Match people by their centroids, but count only full bounding-box crossings.
 * Track IDs live only in memory and disappear after a short timeout.
 */
export class CrossingTracker {
  constructor(options = {}) {
    this.nextId = 1;
    this.tracks = new Map();
    this.options = {
      maxDistance: options.maxDistance ?? 140,
      maxAgeMs: options.maxAgeMs ?? 1200,
      hysteresis: options.hysteresis ?? 12,
    };
  }

  reset() {
    this.nextId = 1;
    this.tracks.clear();
  }

  update(boxes, timestamp, config) {
    // Expire BEFORE matching: a new person must not inherit a stale crossing.
    for (const [id, track] of this.tracks) {
      if (timestamp - track.lastSeen > this.options.maxAgeMs) this.tracks.delete(id);
    }
    const availableTrackIds = new Set(this.tracks.keys());
    const events = [];
    const assignments = [];

    for (const box of boxes) {
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width <= 0 || box.height <= 0) continue;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      let bestTrack = null;
      let bestDistance = this.options.maxDistance;

      for (const trackId of availableTrackIds) {
        const track = this.tracks.get(trackId);
        const candidateDistance = distance(point, track.point);
        if (candidateDistance < bestDistance) {
          bestTrack = track;
          bestDistance = candidateDistance;
        }
      }

      if (bestTrack) {
        availableTrackIds.delete(bestTrack.id);
        assignments.push({ track: bestTrack, point, box });
      } else {
        const side = stableSide(
          box,
          config.orientation,
          config.lineCoordinate,
          this.options.hysteresis,
        );
        const track = {
          id: this.nextId++,
          point,
          stableSide: side,
          lastSeen: timestamp,
        };
        this.tracks.set(track.id, track);
      }
    }

    for (const { track, point, box } of assignments) {
      const newSide = stableSide(
        box,
        config.orientation,
        config.lineCoordinate,
        this.options.hysteresis,
      );

      if (
        newSide !== 0 &&
        track.stableSide !== 0 &&
        newSide !== track.stableSide
      ) {
        const rawDirection = track.stableSide === -1
          ? "negative-to-positive"
          : "positive-to-negative";
        events.push({
          type: rawDirection === config.entryDirection ? "entry" : "exit",
          rawDirection,
          trackId: track.id,
          timestamp,
        });
      }

      // Remember the last fully occupied side while the box overlaps the line.
      // A first detection on the line has no origin and therefore cannot count.
      if (newSide !== 0) track.stableSide = newSide;
      track.point = point;
      track.lastSeen = timestamp;
    }

    for (const [trackId, track] of this.tracks) {
      if (timestamp - track.lastSeen > this.options.maxAgeMs) {
        this.tracks.delete(trackId);
      }
    }

    return {
      events,
      tracks: [...this.tracks.values()].map((track) => ({ ...track })),
    };
  }
}

export function computeLineCoordinate(orientation, percentage, width, height) {
  const size = orientation === "horizontal" ? height : width;
  return size * (percentage / 100);
}
