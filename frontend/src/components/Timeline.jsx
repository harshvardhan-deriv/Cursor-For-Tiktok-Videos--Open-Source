import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause, Trash2, GripVertical, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { computeTimelineStarts, getTotalDuration, DEFAULT_FPS } from '../lib/timelineState';
import './Timeline.css';

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 200;
const SNAP_THRESHOLD_PX = 5;
const SNAP_PX = 28;

function formatTimecode(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Timeline({
  tracks,
  onRemoveClip,
  onReorderClips,
  onClipDrop,
  onClipClick,
  onClipUpdate,
  onTrimPreview,
  onSplitAtPlayhead,
  totalDuration: propTotalDuration,
  currentTime = 0,
  onSeek,
  fps = DEFAULT_FPS,
  isPlaying = false,
  onPlayTimeline,
  onPlayPause,
  selectedClipIndex = null,
  onSelectClip,
  onKeyframeAdd,
  onKeyframeMove,
  onKeyframeRemove,
  selectedKeyframe = null,
  onClipMoveInTime
}) {
  const [draggedClip, setDraggedClip] = useState(null);
  const [dragOverIndex, setDraggedOverIndex] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [pxPerSecond, setPxPerSecond] = useState(50);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const [trimTooltip, setTrimTooltip] = useState(null);
  const [keyframeDragging, setKeyframeDragging] = useState(null);
  const [snapGuideTime, setSnapGuideTime] = useState(null);
  const trackRef = useRef(null);
  const scrollRef = useRef(null);
  const rulerRef = useRef(null);

  const timelineStarts = useMemo(() => computeTimelineStarts(tracks), [tracks]);
  const totalDuration = useMemo(() => getTotalDuration(tracks), [tracks]);

  const rulerStep = pxPerSecond >= 80 ? 1 : pxPerSecond >= 40 ? 2 : 5;
  const snapTargets = useMemo(() => {
    const out = [];
    out.push({ time: 0, xPx: 0, priority: 0 });
    for (let j = 0; j < tracks.length; j++) {
      const s = timelineStarts[j];
      const inPt = tracks[j].startTime ?? 0;
      const outPt = tracks[j].endTime ?? 10;
      const e = s + (outPt - inPt);
      out.push({ time: s, xPx: s * pxPerSecond, priority: 1 });
      out.push({ time: e, xPx: e * pxPerSecond, priority: 1 });
    }
    for (let t = rulerStep; t <= totalDuration; t += rulerStep) {
      out.push({ time: t, xPx: t * pxPerSecond, priority: 2 });
    }
    return out;
  }, [tracks, timelineStarts, totalDuration, pxPerSecond, rulerStep]);

  function getSnappedTime(draggedIndex, rawTime, mouseXPx) {
    if (draggedIndex < 0 || draggedIndex >= tracks.length) {
      return { time: Math.max(0, rawTime), guide: null };
    }
    const clip = tracks[draggedIndex];
    const inP = clip.startTime ?? 0;
    const outP = clip.endTime ?? 10;
    const draggedDur = Math.max(0.001, outP - inP);

    const clipEndAt = (idx) => {
      const s = timelineStarts[idx];
      const inPt = tracks[idx].startTime ?? 0;
      const outPt = tracks[idx].endTime ?? 10;
      return s + (outPt - inPt);
    };

    const wouldOverlap = (startTime, dur, excludeIdx) => {
      const myEnd = startTime + dur;
      for (let k = 0; k < tracks.length; k++) {
        if (k === excludeIdx) continue;
        const sk = timelineStarts[k];
        const ek = clipEndAt(k);
        if (startTime < ek && myEnd > sk) return true;
      }
      return false;
    };

    if (!snapEnabled) return { time: Math.max(0, rawTime), guide: null };

    let bestTime = rawTime;
    let bestGuide = null;
    let bestPriority = Infinity;
    let bestDistPx = Infinity;

    for (const target of snapTargets) {
      const distPx = Math.abs(mouseXPx - target.xPx);
      if (distPx > SNAP_PX) continue;

      const candidateStartLeft = target.time;
      const candidateStartRight = target.time - draggedDur;
      for (const candidate of [candidateStartLeft, candidateStartRight]) {
        const t = Math.max(0, candidate);
        if (wouldOverlap(t, draggedDur, draggedIndex)) continue;
        const distFromRawPx = Math.abs(t - rawTime) * pxPerSecond;
        const better =
          target.priority < bestPriority ||
          (target.priority === bestPriority && distFromRawPx < bestDistPx);
        if (better) {
          bestPriority = target.priority;
          bestDistPx = distFromRawPx;
          bestTime = t;
          bestGuide = target.time;
        }
      }
    }

    return { time: Math.max(0, bestTime), guide: bestGuide };
  }

  const getTrackX = useCallback(
    (e) => {
      const track = trackRef.current;
      const scrollEl = scrollRef.current;
      if (!track || !scrollEl) return 0;
      const rect = track.getBoundingClientRect();
      return e.clientX - rect.left + scrollEl.scrollLeft;
    },
    []
  );

  const frameDuration = 1 / fps;

  const roundToFrame = (t) => Math.round(t / frameDuration) * frameDuration;

  const getSnapTime = (time) => {
    if (!snapEnabled) return time;
    let best = time;
    let bestDistPx = Infinity;
    const consider = (t) => {
      const distPx = Math.abs(t - time) * pxPerSecond;
      if (distPx < bestDistPx && distPx <= SNAP_THRESHOLD_PX) {
        bestDistPx = distPx;
        best = t;
      }
    };
    consider(0);
    for (let t = rulerStep; t <= totalDuration; t += rulerStep) consider(t);
    timelineStarts.forEach((start, i) => {
      const inPoint = tracks[i].startTime ?? 0;
      const outPoint = tracks[i].endTime ?? 10;
      const end = start + (outPoint - inPoint);
      consider(start);
      consider(end);
    });
    return best;
  };

  const zoom = (delta) => {
    setPxPerSecond((p) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, p + delta)));
  };

  useEffect(() => {
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoom(e.deltaY > 0 ? -5 : 5);
      }
    };
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.closest('input') || e.target.closest('textarea')) return;
      switch (e.key) {
        case 's':
        case 'S':
          if (!e.ctrlKey && !e.metaKey && onSplitAtPlayhead) {
            e.preventDefault();
            onSplitAtPlayhead();
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedClipIndex != null && onRemoveClip) {
            e.preventDefault();
            onRemoveClip(selectedClipIndex);
            if (onSelectClip) onSelectClip(null);
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoom(10);
          break;
        case '-':
          e.preventDefault();
          zoom(-10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (onSeek) onSeek(Math.max(0, currentTime - (e.shiftKey ? 1 : 0.1)));
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (onSeek) onSeek(Math.min(totalDuration, currentTime + (e.shiftKey ? 1 : 0.1)));
          break;
        case ' ':
          e.preventDefault();
          if (onPlayPause) onPlayPause();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTime, totalDuration, selectedClipIndex, onSeek, onRemoveClip, onSplitAtPlayhead, onPlayPause, onSelectClip]);

  const handlePlayheadMouseDown = (e) => {
    e.preventDefault();
    setPlayheadDragging(true);
  };

  useEffect(() => {
    if (!playheadDragging || !onSeek) return;
    const handleMove = (e) => {
      const scrollEl = scrollRef.current;
      const track = trackRef.current;
      if (!scrollEl || !track) return;
      const trackRect = track.getBoundingClientRect();
      const x = e.clientX - trackRect.left + scrollEl.scrollLeft;
      const time = (x / pxPerSecond);
      const clamped = Math.max(0, Math.min(totalDuration, time));
      const snapped = getSnapTime(clamped);
      onSeek(snapped);
    };
    const handleUp = () => setPlayheadDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [playheadDragging, onSeek, pxPerSecond, totalDuration, snapEnabled, tracks, timelineStarts]);

  const handleTrackClick = (e) => {
    if (e.target === trackRef.current || e.target.closest('.timeline-ruler-inner')) {
      const scrollEl = scrollRef.current;
      const track = trackRef.current;
      if (scrollEl && track) {
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollEl.scrollLeft;
        const time = Math.max(0, Math.min(totalDuration, x / pxPerSecond));
        if (onSeek) onSeek(getSnapTime(time));
      }
    }
    if (!e.target.closest('.timeline-clip-item') && onSelectClip) onSelectClip(null);
  };

  const handleDragStart = (e, index) => {
    if (resizing) {
      e.preventDefault();
      return;
    }
    setDraggedClip(index);
    e.dataTransfer.setData('source', 'timeline');
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    setDraggedOverIndex(index);
    if (draggedClip != null && snapEnabled) {
      const x = getTrackX(e);
      const rawTime = Math.max(0, Math.min(totalDuration, x / pxPerSecond));
      const { guide } = getSnappedTime(draggedClip, rawTime, x);
      setSnapGuideTime(guide != null ? guide : null);
    }
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    const source = e.dataTransfer.getData('source');
    if (source === 'timeline' && draggedClip !== null) {
      if (onClipMoveInTime && trackRef.current) {
        const x = getTrackX(e);
        const rawTime = Math.max(0, Math.min(totalDuration, x / pxPerSecond));
        const { time, guide } = getSnappedTime(draggedClip, rawTime, x);
        onClipMoveInTime(draggedClip, time);
        if (guide != null) {
          setSnapGuideTime(guide);
          setTimeout(() => setSnapGuideTime(null), 250);
        }
      } else if (draggedClip !== index && onReorderClips) {
        onReorderClips(draggedClip, index);
      }
      setDraggedClip(null);
      setDraggedOverIndex(null);
      setSnapGuideTime(null);
      return;
    }
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const mediaData = JSON.parse(dataStr);
      if (mediaData && onClipDrop) onClipDrop(mediaData, index);
    } catch (err) {
      console.error('Invalid drop data', err);
    }
    setDraggedOverIndex(null);
  };

  const handleContainerDrop = (e) => {
    e.preventDefault();
    if (e.target.closest('.timeline-clip-item')) return;
    const source = e.dataTransfer.getData('source');
    if (source === 'timeline' && draggedClip !== null && onClipMoveInTime && trackRef.current) {
      const x = getTrackX(e);
      const rawTime = Math.max(0, Math.min(totalDuration, x / pxPerSecond));
      const { time, guide } = getSnappedTime(draggedClip, rawTime, x);
      onClipMoveInTime(draggedClip, time);
      if (guide != null) {
        setSnapGuideTime(guide);
        setTimeout(() => setSnapGuideTime(null), 250);
      }
      setDraggedClip(null);
      setDraggedOverIndex(null);
      setSnapGuideTime(null);
      return;
    }
    if (source !== 'timeline' && onClipDrop) {
      try {
        const dataStr = e.dataTransfer.getData('application/json');
        if (dataStr) {
          const mediaData = JSON.parse(dataStr);
          onClipDrop(mediaData, tracks.length);
        }
      } catch (_) {}
    }
  };

  const handleResizeStart = (e, index, side) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = tracks[index];
    const initialVal = side === 'left' ? (clip.startTime ?? 0) : (clip.endTime ?? 10);
    setResizing({ index, side, startX: e.clientX, initialVal });
  };

  useEffect(() => {
    if (!resizing) return;
    const clip = tracks[resizing.index];
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const minDur = frameDuration;

    const handleMouseMove = (e) => {
      const deltaPx = e.clientX - resizing.startX;
      const deltaTime = deltaPx / pxPerSecond;
      let newVal = resizing.initialVal + deltaTime;
      newVal = roundToFrame(newVal);

      const updateClip = (updates) => {
        if (onClipUpdate) onClipUpdate(resizing.index, { ...tracks[resizing.index], ...updates });
      };

      if (resizing.side === 'left') {
        const currentEnd = clip.endTime ?? 10;
        newVal = Math.max(0, Math.min(newVal, currentEnd - minDur));
        const delta = newVal - inPoint;
        updateClip({
          startTime: parseFloat(newVal.toFixed(3)),
          startOffset: (clip.startOffset ?? 0) + delta
        });
        if (onTrimPreview) onTrimPreview(resizing.index, clip.startOffset + delta);
        setTrimTooltip({ index: resizing.index, delta: -delta, time: newVal });
      } else {
        const currentStart = clip.startTime ?? 0;
        newVal = Math.max(currentStart + minDur, newVal);
        updateClip({ endTime: parseFloat(newVal.toFixed(3)) });
        const newDuration = newVal - currentStart;
        if (onTrimPreview) onTrimPreview(resizing.index, (clip.startOffset ?? 0) + newDuration);
        setTrimTooltip({ index: resizing.index, delta: newVal - (clip.endTime ?? 10), time: newVal });
      }
    };
    const handleMouseUp = () => {
      setResizing(null);
      setTrimTooltip(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, tracks, pxPerSecond, fps, onClipUpdate, onTrimPreview]);

  useEffect(() => {
    if (!keyframeDragging || !onKeyframeMove) return;
    const clip = tracks[keyframeDragging.index];
    const inPoint = clip?.startTime ?? 0;
    const outPoint = clip?.endTime ?? 10;
    const duration = Math.max(0.001, outPoint - inPoint);
    const handleMove = (e) => {
      const deltaPx = e.clientX - keyframeDragging.startX;
      const deltaT = deltaPx / pxPerSecond;
      let newT = keyframeDragging.startT + deltaT;
      newT = Math.max(0, Math.min(duration, newT));
      onKeyframeMove(keyframeDragging.index, keyframeDragging.kfIdx, newT);
    };
    const handleUp = () => setKeyframeDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [keyframeDragging, onKeyframeMove, pxPerSecond, tracks]);

  const trackWidth = totalDuration * pxPerSecond;
  const playheadLeft = currentTime * pxPerSecond;

  const rulerTicks = [];
  for (let t = 0; t <= totalDuration; t += rulerStep) {
    rulerTicks.push({ time: t, left: t * pxPerSecond });
  }

  return (
    <div className="timeline-container pro-timeline">
      <div className="timeline-header">
        <h3>Timeline</h3>
        <div className="timeline-controls">
          <span className="duration-display">{formatTimecode(totalDuration)}</span>
          <button
            type="button"
            className="timeline-snap-btn"
            title="Snap to edges"
            onClick={() => setSnapEnabled((s) => !s)}
            data-active={snapEnabled}
          >
            Snap
          </button>
          <button type="button" className="button icon small" onClick={() => zoom(-10)} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button type="button" className="button icon small" onClick={() => zoom(10)} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          {onPlayPause && (
            <button
              type="button"
              className="button primary small"
              onClick={onPlayPause}
              disabled={tracks.length === 0}
              title="Play / Pause (Space)"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              {isPlaying ? ' Pause' : ' Play'}
            </button>
          )}
          {!onPlayPause && onPlayTimeline && (
            <button type="button" className="button primary small" onClick={onPlayTimeline} disabled={tracks.length === 0}>
              <Play size={14} /> Play
            </button>
          )}
        </div>
      </div>

      <div className="timeline-scroll-wrap" ref={scrollRef} style={{ overflowX: 'auto' }}>
        <div className="timeline-scroll-content" style={{ width: Math.max(trackWidth, 400) }}>
          <div className="timeline-ruler" ref={rulerRef}>
            <div className="timeline-ruler-inner" style={{ width: trackWidth }}>
              {rulerTicks.map(({ time, left }) => (
                <div
                  key={time}
                  className={`ruler-tick ${snapGuideTime === time ? 'ruler-tick-snap-highlight' : ''}`}
                  style={{ left: `${left}px` }}
                  title={formatTimecode(time)}
                >
                  <span className="ruler-label">{formatTimecode(time)}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            className="timeline-track horizontal-track"
            style={{ width: trackWidth }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedClip != null && snapEnabled) {
                const x = getTrackX(e);
                const rawTime = Math.max(0, Math.min(totalDuration, x / pxPerSecond));
                const { guide } = getSnappedTime(draggedClip, rawTime, x);
                setSnapGuideTime(guide != null ? guide : null);
              }
            }}
            onDrop={handleContainerDrop}
            onClick={handleTrackClick}
            ref={trackRef}
          >
          {tracks.length === 0 ? (
            <div className="timeline-empty-state">
              <p>Drag clips here or drop to add</p>
            </div>
          ) : (
            tracks.map((clip, index) => {
              const inPoint = clip.startTime ?? 0;
              const outPoint = clip.endTime ?? 10;
              const duration = outPoint - inPoint;
              const start = timelineStarts[index];
              const leftPx = start * pxPerSecond;
              const widthPx = Math.max(20, duration * pxPerSecond);
              const isSelected = selectedClipIndex === index;

              return (
                <div
                  key={`${clip.timelineId || clip.id}-${index}`}
                  className={`timeline-clip-item ${draggedClip === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''} ${isSelected ? 'selected' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${leftPx}px`,
                    width: `${widthPx}px`,
                    height: '80px'
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={() => {
                    setDraggedClip(null);
                    setDraggedOverIndex(null);
                    setSnapGuideTime(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onClipClick) onClipClick(index, clip);
                    if (onSelectClip) onSelectClip(index);
                  }}
                  title={`${clip.name ?? clip.filename} · ${inPoint.toFixed(1)}s – ${outPoint.toFixed(1)}s`}
                >
                  <div
                    className="resize-handle left-handle"
                    onMouseDown={(e) => handleResizeStart(e, index, 'left')}
                  >
                    <ChevronLeft size={10} />
                  </div>
                  <div className="clip-handle-grab">
                    <GripVertical size={12} />
                  </div>
                  <div className="clip-info">
                    <span className="clip-label">{clip.name ?? clip.filename}</span>
                    <span className="clip-times">{inPoint.toFixed(1)}s – {outPoint.toFixed(1)}s</span>
                  </div>
                  <button
                    type="button"
                    className="clip-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveClip(index);
                      if (onSelectClip) onSelectClip(null);
                    }}
                    title="Delete (Del)"
                  >
                    <Trash2 size={10} />
                  </button>
                  <div
                    className="resize-handle right-handle"
                    onMouseDown={(e) => handleResizeStart(e, index, 'right')}
                  >
                    <ChevronRight size={10} />
                  </div>
                  <div className="timeline-keyframe-strip" aria-hidden>
                    {(clip.keyframes || []).map((kf, kfIdx) => {
                      const dotLeft = kf.t * pxPerSecond;
                      const isKeyframeSelected = selectedKeyframe?.clipIndex === index && selectedKeyframe?.keyframeIndex === kfIdx;
                      const isClipSelected = selectedClipIndex === index;
                      return (
                        <div
                          key={kfIdx}
                          className={`timeline-keyframe-dot ${isKeyframeSelected ? 'selected' : ''} ${!isClipSelected ? 'timeline-keyframe-dot-unselected' : ''}`}
                          style={{ left: `${dotLeft}px` }}
                          title={`Keyframe at ${kf.t.toFixed(1)}s`}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (onSelectClip) onSelectClip(index);
                            setKeyframeDragging({ index, kfIdx, startX: e.clientX, startT: kf.t });
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectClip) onSelectClip(index);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          <div
            className="timeline-playhead"
            style={{
              left: `${playheadLeft}px`,
              pointerEvents: playheadDragging ? 'none' : 'auto'
            }}
            onMouseDown={handlePlayheadMouseDown}
            title={formatTimecode(currentTime)}
          />
          {snapGuideTime != null && (
            <div
              className="timeline-snap-guide"
              style={{ left: `${snapGuideTime * pxPerSecond}px` }}
              aria-hidden
            />
          )}
          {trimTooltip && (
            <div className="timeline-trim-tooltip" style={{ left: `${trimTooltip.time * pxPerSecond}px` }}>
              Δ {trimTooltip.delta >= 0 ? '+' : ''}{trimTooltip.delta.toFixed(2)}s
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
