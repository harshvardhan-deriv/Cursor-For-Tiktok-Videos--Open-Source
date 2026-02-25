/**
 * Timeline state helpers: clip model and export payload.
 * Clips use in (source in-point), out (source out-point), start (timeline position), duration (= out - in).
 * Keyframes: clip.keyframes = [{ t, value: { positionX, positionY, scale, rotation } }], t is time within clip.
 */

export const DEFAULT_FPS = 30;

const defaultTransform = () => ({ positionX: 0, positionY: 0, scale: 1, rotation: 0 });

/**
 * Linear interpolation between two keyframe values at time t.
 * @param {Array<{ t: number, value: object }>} keyframes sorted by t
 * @param {number} t time within clip
 * @param {string} prop property name (e.g. 'scale', 'positionY')
 * @returns {number}
 */
function lerpKeyframes(keyframes, t, prop) {
  if (!keyframes?.length) return undefined;
  const values = keyframes.map((k) => ({ t: k.t, v: k.value?.[prop] }));
  if (values.every((v) => v.v == null)) return undefined;
  const first = values.find((v) => v.v != null);
  const last = [...values].reverse().find((v) => v.v != null);
  if (!first || first.t > t) return first?.v;
  if (!last || last.t < t) return last?.v;
  let i = 0;
  while (i < values.length && values[i].t <= t) i++;
  const a = values[i - 1];
  const b = values[i];
  if (!a || a.v == null) return b?.v;
  if (!b || b.v == null || a.t === b.t) return a.v;
  const frac = (t - a.t) / (b.t - a.t);
  return a.v + frac * (b.v - a.v);
}

/**
 * Get interpolated transform for a clip at time-in-clip t.
 * @param {{ keyframes?: Array<{ t: number, value: object }>, transforms?: object }} clip
 * @param {number} timeInClip seconds within the clip
 * @returns {{ positionX: number, positionY: number, scale: number, rotation: number }}
 */
export function getTransformAtTime(clip, timeInClip) {
  if (!clip) return defaultTransform();
  const base = clip.transforms || defaultTransform();
  const kfs = clip.keyframes;
  if (!kfs?.length) {
    return {
      positionX: base.positionX ?? 0,
      positionY: base.positionY ?? 0,
      scale: base.scale ?? 1,
      rotation: base.rotation ?? 0
    };
  }
  return {
    positionX: lerpKeyframes(kfs, timeInClip, 'positionX') ?? base.positionX ?? 0,
    positionY: lerpKeyframes(kfs, timeInClip, 'positionY') ?? base.positionY ?? 0,
    scale: lerpKeyframes(kfs, timeInClip, 'scale') ?? base.scale ?? 1,
    rotation: lerpKeyframes(kfs, timeInClip, 'rotation') ?? base.rotation ?? 0
  };
}

/**
 * Compute timeline start time for each clip.
 * Uses clip.timelineStart when set (drag-to-position); otherwise sequential (sum of previous durations).
 * @param {Array<{ startTime?: number, endTime?: number, timelineStart?: number }>} tracks
 * @returns {number[]} timeline start time per clip in seconds
 */
export function computeTimelineStarts(tracks) {
  if (!Array.isArray(tracks)) return [];
  const starts = [];
  let sequentialEnd = 0;
  for (const clip of tracks) {
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const duration = Math.max(0, outPoint - inPoint);
    const start = clip.timelineStart !== undefined && clip.timelineStart !== null
      ? Math.max(0, clip.timelineStart)
      : sequentialEnd;
    starts.push(start);
    sequentialEnd = start + duration;
  }
  return starts;
}

/**
 * Get the active clip at timeline time t. Single source of truth for playback/scrub.
 * @param {Array} tracks
 * @param {number[]} timelineStarts from computeTimelineStarts(tracks)
 * @param {number} t timeline time in seconds
 * @returns {null|{ index: number, clip: object, start: number, end: number, mediaTime: number }} null if in gap
 */
export function getActiveClipAtTime(tracks, timelineStarts, t) {
  if (!Array.isArray(tracks) || !Array.isArray(timelineStarts) || tracks.length === 0) return null;
  for (let i = 0; i < tracks.length; i++) {
    const start = timelineStarts[i];
    const clip = tracks[i];
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const end = start + (outPoint - inPoint);
    if (t >= start && t < end) {
      const mediaTime = inPoint + (t - start);
      return { index: i, clip, start, end, mediaTime };
    }
  }
  return null;
}

/**
 * Total timeline duration = max(clip start + clip duration).
 * @param {Array<{ startTime?: number, endTime?: number, timelineStart?: number }>} tracks
 * @returns {number}
 */
export function getTotalDuration(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return 0;
  const starts = computeTimelineStarts(tracks);
  let maxEnd = 0;
  tracks.forEach((clip, i) => {
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const duration = Math.max(0, outPoint - inPoint);
    maxEnd = Math.max(maxEnd, starts[i] + duration);
  });
  return maxEnd;
}

/**
 * Build export payload for one track: filename, start, end, and optional in_point, out_point, timeline_start.
 * Backend uses in_point/out_point when present and sorts by timeline_start.
 * @param {Array<{ filename?: string, name?: string, startTime?: number, endTime?: number }>} tracks
 * @returns {{ filename: string, start: number, end: number, in_point?: number, out_point?: number, timeline_start?: number }[]}
 */
export function tracksToExportClips(tracks) {
  if (!Array.isArray(tracks)) return [];
  const starts = computeTimelineStarts(tracks);
  return tracks
    .map((t, i) => ({ clip: t, start: starts[i] }))
    .sort((a, b) => a.start - b.start)
    .map(({ clip: t, start }) => {
    const inPoint = t.startTime ?? 0;
    const outPoint = t.endTime ?? 10;
    return {
      filename: t.filename || t.name,
      start: inPoint,
      end: outPoint,
      in_point: inPoint,
      out_point: outPoint,
      timeline_start: start
    };
  });
}
