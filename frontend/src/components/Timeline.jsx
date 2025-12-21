import React, { useState, useEffect } from 'react';
import { Play, Trash2, GripVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import './Timeline.css';

export function Timeline({
  tracks,
  onRemoveClip,
  onReorderClips,
  onPlayTimeline,
  onClipDrop,
  onClipClick,
  onClipUpdate,
  onTrimPreview, // New prop for seeking video
  totalDuration = 60
}) {
  const [draggedClip, setDraggedClip] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [resizing, setResizing] = useState(null); // { index, side: 'left'|'right', startX, initialVal }

  // Drag from Timeline itself (reordering)
  const handleDragStart = (e, index) => {
    // Don't start drag if we are resizing
    if (resizing) {
      e.preventDefault();
      return;
    }
    setDraggedClip(index);
    e.dataTransfer.setData('source', 'timeline'); // Mark source
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  // Dropping into the timeline
  const handleDrop = (e, index) => {
    e.preventDefault();
    const source = e.dataTransfer.getData('source');

    // Internal Reorder
    if (source === 'timeline' && draggedClip !== null) {
      if (draggedClip !== index) {
        onReorderClips(draggedClip, index);
      }
      setDraggedClip(null);
      setDragOverIndex(null);
      return;
    }

    // Drop from Media Library
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const mediaData = JSON.parse(dataStr);
      if (mediaData && onClipDrop) {
        onClipDrop(mediaData, index); // Pass index to insert at specific position
      }
    } catch (err) {
      console.error("Invalid drop data", err);
    }
    setDragOverIndex(null);
  };

  // Handling drop on the empty area (append)
  const handleContainerDrop = (e) => {
    e.preventDefault();
    // Wait, we need to check if target is not a clip.
    if (e.target.closest('.timeline-clip-item')) return;

    const source = e.dataTransfer.getData('source');
    if (source !== 'timeline') {
      try {
        const dataStr = e.dataTransfer.getData('application/json');
        if (dataStr && onClipDrop) {
          const mediaData = JSON.parse(dataStr);
          onClipDrop(mediaData, tracks.length); // Append to end
        }
      } catch (err) {
        // ignore
      }
    }
  };

  const handleDragEnd = () => {
    setDraggedClip(null);
    setDragOverIndex(null);
  };

  // Resizing Logic
  const handleResizeStart = (e, index, side) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = tracks[index];
    const initialVal = side === 'left' ? (clip.startTime || 0) : (clip.endTime || 10);
    setResizing({ index, side, startX: e.clientX, initialVal });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!resizing) return;

      const deltaX = e.clientX - resizing.startX;
      // Scale pixel delta to time. 1px = 0.1s
      const timeDelta = deltaX * 0.1;

      let newVal = resizing.initialVal + timeDelta;

      // Helper to update clip
      const updateClip = (updates) => {
        if (onClipUpdate) onClipUpdate(resizing.index, { ...tracks[resizing.index], ...updates });
      };

      if (resizing.side === 'left') {
        // Trim start: cannot be < 0, cannot be > endTime
        const currentEnd = tracks[resizing.index].endTime !== undefined ? tracks[resizing.index].endTime : 10;
        let diff = newVal - resizing.initialVal; // Check delta
        // We need to know previous Start Time to calculate delta cleanly? 
        // Or simpler: New Start Time determines new Start Offset.
        // If we move start from 0 to 2. Delta is +2.
        // startOffset should increase by 2.
        // But what if we are moving back?
        // We rely on consistent state.

        // Actually, tracks[resizing.index] is current state.
        // Wait, handleMouseMove uses closure 'tracks' from render. 
        // It might be stale if onClipUpdate triggers re-render?
        // Yes it triggers re-render. So 'tracks' is fresh?
        // If re-render happens, 'resizing' state might be lost if we don't persist key?
        // No, 'resizing' is local state. Re-render keeps it.
        // But useEffect dependency 'tracks' restarts listener? 
        // Yes. This causes stutter.
        // We should probably NOT depend on tracks in useEffect if we want smooth drag.
        // But we need track data.

        // Better: Calculate delta based on mouse X, independent of track state updates?
        // Let's assume onClipUpdate is fast enough.

        const originalStart = tracks[resizing.index].startTime || 0;
        const originalOffset = tracks[resizing.index].startOffset || 0;

        // Constraint: newVal cannot be > currentEnd - 0.5
        newVal = Math.max(0, Math.min(newVal, currentEnd - 0.5));

        const delta = newVal - originalStart;

        const updates = {
          startTime: parseFloat(newVal.toFixed(1)),
          startOffset: originalOffset + delta
        };
        updateClip(updates);

        // Seek Preview
        if (onTrimPreview) onTrimPreview(resizing.index, updates.startOffset);

      } else {
        // Trim end
        const currentStart = tracks[resizing.index].startTime || 0;
        const currentOffset = tracks[resizing.index].startOffset || 0;
        newVal = Math.max(currentStart + 0.5, newVal);
        updateClip({ endTime: parseFloat(newVal.toFixed(1)) });

        // Seek Preview (End trim shows the new end frame)
        // End frame time in source = startOffset + duration
        // duration = newVal - currentStart
        const newDuration = newVal - currentStart;
        if (onTrimPreview) onTrimPreview(resizing.index, currentOffset + newDuration);
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    if (resizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, tracks, onClipUpdate]);


  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <h3>Timeline Sequence</h3>
        <div className="timeline-controls">
          <span className="duration-display">Total Clips: {tracks.length}</span>
          <button className="button primary small" onClick={onPlayTimeline} disabled={tracks.length === 0}>
            <Play size={14} /> Play Sequence
          </button>
        </div>
      </div>

      <div
        className="timeline-track horizontal-track"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleContainerDrop}
      >
        {tracks.length === 0 ? (
          <div className="timeline-empty-state">
            <p>Drag clips here to start</p>
          </div>
        ) : (
          <div className="clips-row">
            {tracks.map((clip, index) => {
              const start = clip.startTime || 0;
              const end = clip.endTime !== undefined ? clip.endTime : 10; // Default 10s if not set
              const duration = end - start;
              // Min width 60px, linear width based on duration * 20px/s
              const width = Math.max(80, duration * 20);

              return (
                <div
                  key={`${clip.timelineId || clip.id}-${index}`}
                  className={`timeline-clip-item ${draggedClip === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                  style={{ width: `${width}px`, position: 'relative' }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onClipClick) onClipClick(index, clip);
                  }}
                  title={`${clip.name} (${start.toFixed(1)}s - ${end.toFixed(1)}s)`}
                >
                  {/* Left Handle */}
                  <div
                    className="resize-handle left-handle"
                    onMouseDown={(e) => handleResizeStart(e, index, 'left')}
                  ><ChevronLeft size={10} /></div>

                  <div className="clip-handle-grab"><GripVertical size={12} /></div>
                  <div className="clip-info">
                    <span className="clip-label">{clip.name}</span>
                    <span className="clip-times">{start.toFixed(1)}s - {end.toFixed(1)}s</span>
                  </div>
                  <button
                    className="clip-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveClip(index);
                    }}
                  >
                    <Trash2 size={10} />
                  </button>

                  {/* Right Handle */}
                  <div
                    className="resize-handle right-handle"
                    onMouseDown={(e) => handleResizeStart(e, index, 'right')}
                  ><ChevronRight size={10} /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
