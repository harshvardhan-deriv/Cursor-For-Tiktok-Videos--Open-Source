/**
 * Timeline state unit tests: clip positions, total duration, export order.
 * Run: npm run test -- src/lib/timelineState.test.js
 */
import { describe, it, expect } from "vitest";
import {
  computeTimelineStarts,
  getTotalDuration,
  tracksToExportClips,
  getTransformAtTime,
  getActiveClipAtTime,
} from "./timelineState";

describe("timelineState", () => {
  describe("computeTimelineStarts", () => {
    it("returns empty array for empty tracks", () => {
      expect(computeTimelineStarts([])).toEqual([]);
    });

    it("sequential: 5s clip then 12s clip gives starts [0, 5]", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 12 },
      ];
      expect(computeTimelineStarts(tracks)).toEqual([0, 5]);
    });

    it("uses timelineStart when set (drag to position)", () => {
      const tracks = [
        { startTime: 0, endTime: 5, timelineStart: 10 },
        { startTime: 0, endTime: 12 },
      ];
      expect(computeTimelineStarts(tracks)).toEqual([10, 15]);
    });

    it("total duration from two sequential 5s and 12s is 17", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 12 },
      ];
      const starts = computeTimelineStarts(tracks);
      expect(starts).toEqual([0, 5]);
      expect(getTotalDuration(tracks)).toBe(17);
    });
  });

  describe("getTotalDuration", () => {
    it("returns 0 for empty tracks", () => {
      expect(getTotalDuration([])).toBe(0);
    });

    it("single clip duration = endTime - startTime", () => {
      expect(getTotalDuration([{ startTime: 0, endTime: 7 }])).toBe(7);
    });

    it("two sequential clips: 5 + 12 = 17", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 12 },
      ];
      expect(getTotalDuration(tracks)).toBe(17);
    });

    it("with timelineStart (gap): max of clip ends", () => {
      const tracks = [
        { startTime: 0, endTime: 5, timelineStart: 0 },
        { startTime: 0, endTime: 12, timelineStart: 10 },
      ];
      expect(getTotalDuration(tracks)).toBe(22);
    });
  });

  describe("tracksToExportClips", () => {
    it("sorts by timeline_start when clips have timelineStart", () => {
      const tracks = [
        { filename: "b.mp4", startTime: 0, endTime: 12, timelineStart: 10 },
        { filename: "a.mp4", startTime: 0, endTime: 5, timelineStart: 0 },
      ];
      const out = tracksToExportClips(tracks);
      expect(out[0].filename).toBe("a.mp4");
      expect(out[0].timeline_start).toBe(0);
      expect(out[1].filename).toBe("b.mp4");
      expect(out[1].timeline_start).toBe(10);
    });

    it("exports in/out and timeline_start", () => {
      const tracks = [
        { filename: "v1.mp4", startTime: 0, endTime: 5 },
        { filename: "v2.mp4", startTime: 1, endTime: 10 },
      ];
      const out = tracksToExportClips(tracks);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ filename: "v1.mp4", start: 0, end: 5, timeline_start: 0 });
      expect(out[1]).toMatchObject({ filename: "v2.mp4", start: 1, end: 10, timeline_start: 5 });
    });
  });

  describe("getActiveClipAtTime", () => {
    it("returns null for empty tracks", () => {
      expect(getActiveClipAtTime([], [], 0)).toBeNull();
    });

    it("returns null when t is in gap", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 5, timelineStart: 10 },
      ];
      const starts = computeTimelineStarts(tracks);
      expect(getActiveClipAtTime(tracks, starts, 7)).toBeNull();
    });

    it("returns first clip at t=0", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 5, timelineStart: 10 },
      ];
      const starts = computeTimelineStarts(tracks);
      const active = getActiveClipAtTime(tracks, starts, 0);
      expect(active).not.toBeNull();
      expect(active.index).toBe(0);
      expect(active.start).toBe(0);
      expect(active.end).toBe(5);
      expect(active.mediaTime).toBe(0);
    });

    it("returns second clip with correct mediaTime after gap", () => {
      const tracks = [
        { startTime: 0, endTime: 5 },
        { startTime: 0, endTime: 5, timelineStart: 10 },
      ];
      const starts = computeTimelineStarts(tracks);
      const active = getActiveClipAtTime(tracks, starts, 10.5);
      expect(active).not.toBeNull();
      expect(active.index).toBe(1);
      expect(active.start).toBe(10);
      expect(active.end).toBe(15);
      expect(active.mediaTime).toBe(0.5);
    });
  });

  describe("getTransformAtTime", () => {
    it("returns default transform for null clip", () => {
      expect(getTransformAtTime(null, 0)).toEqual({
        positionX: 0,
        positionY: 0,
        scale: 1,
        rotation: 0,
      });
    });

    it("returns base transform when no keyframes", () => {
      expect(getTransformAtTime({ transforms: { scale: 2 } }, 0)).toMatchObject({
        scale: 2,
        positionX: 0,
        positionY: 0,
        rotation: 0,
      });
    });
  });
});
