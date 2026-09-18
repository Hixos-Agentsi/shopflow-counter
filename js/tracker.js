const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function stableSide(point, orientation, lineCoordinate, hysteresis) {
  const coordinate = orientation === "horizontal" ? point.y : point.x;
  if (coordinate < lineCoordinate - hysteresis) return -1;
  if (coordinate > lineCoordinate + hysteresis) return 1;
  return 0;
}

/**
 * Very small centroid tracker tailored for anonymous doorway counting.
 * Track IDs live only in memory and disappear after a short timeout.
 */
export class CrossingTracker {
  constructor(options = {}) {
    this.nextId = 1;
    this.tracks = new Map();
    this.options = {
      maxDistance: options.maxDistance ?? 140,
      maxAgeMs: options.maxAgeMs ?? 1200,
      cooldownMs: options.cooldownMs ?? 1200,
      hysteresis: options.hysteresis ?? 12,
    };
  }

  reset() {
    this.nextId = 1;
    this.tracks.clear();
  }

  update(points, timestamp, config) {
    // Expire BEFORE matching: a new person must not inherit a stale crossing.
    for (const [id, track] of this.tracks) {
      if (timestamp - track.lastSeen > this.options.maxAgeMs) this.tracks.delete(id);
    }
    const availableTrackIds = new Set(this.tracks.keys());
    const events = [];
    const assignments = [];

    for (const point of points) {
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
        assignments.push({ track: bestTrack, point });
      } else {
        const side = stableSide(
          point,
          config.orientation,
          config.lineCoordinate,
          this.options.hysteresis,
        );
        const track = {
          id: this.nextId++,
          point,
          stableSide: side,
          lastSeen: timestamp,
          lastCounted: -Infinity,
        };
        this.tracks.set(track.id, track);
      }
    }

    for (const { track, point } of assignments) {
      const newSide = stableSide(
        point,
        config.orientation,
        config.lineCoordinate,
        this.options.hysteresis,
      );

      if (
        newSide !== 0 &&
        track.stableSide !== 0 &&
        newSide !== track.stableSide &&
        timestamp - track.lastCounted >= this.options.cooldownMs
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
        track.lastCounted = timestamp;
      }

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
