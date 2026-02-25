import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Upload,
  Wand2,
  Play,
  Volume2,
  RotateCcw,
  Sun,
  Moon,
  Clock,
  Scissors,
  Film,
  Zap,
  Download,
  Plus,
  Video,
  Trash2,
} from "lucide-react";
import { FaTrash } from "react-icons/fa";
import "./VideoEditor.css";
import "./ToastNotification.css";
import { Timeline } from "./Timeline";
import { tracksToExportClips, computeTimelineStarts, getTransformAtTime, getTotalDuration, getActiveClipAtTime } from "../lib/timelineState";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import logo from "/ezlogo_crop.svg";

export function VideoEditor() {
  // State
  const [mediaFiles, setMediaFiles] = useState([]);
  const [editedVersions, setEditedVersions] = useState([]);
  const [activeMediaId, setActiveMediaId] = useState(null); // Used for "Single" view
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [topVideoId, setTopVideoId] = useState(null);
  const [bottomVideoId, setBottomVideoId] = useState(null);
  const [activeSlot, setActiveSlot] = useState("single"); // 'single', 'top', 'bottom' - which slot selected media goes to

  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [isDarkMode, setIsDarkMode] = useState(true); // Changed initial state to true

  // Trimmer State
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(10);
  const [videoDuration, setVideoDuration] = useState(30); // Default dummy, should update on load

  const [isPlaying, setIsPlaying] = useState(false); // Added isPlaying state
  const [isMentioning, setIsMentioning] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [previewMedia, setPreviewMedia] = useState(null);

  // Transform State (Zoom & Pan)
  const [topZoom, setTopZoom] = useState(1);
  const [topPanY, setTopPanY] = useState(0);

  const [bottomZoom, setBottomZoom] = useState(1);
  const [bottomPanY, setBottomPanY] = useState(0);

  const [singleZoom, setSingleZoom] = useState(1);
  const [singlePanY, setSinglePanY] = useState(0);
  const [singlePanX, setSinglePanX] = useState(0);
  const [singleRotation, setSingleRotation] = useState(0);
  const [showSafeArea, setShowSafeArea] = useState(true);

  // Timeline State
  const [timelineTracks, setTimelineTracks] = useState([]); // For Single view
  const [topTimelineTracks, setTopTimelineTracks] = useState([]); // For Split Top
  const [bottomTimelineTracks, setBottomTimelineTracks] = useState([]); // For Split Bottom
  const [audioTracks, setAudioTracks] = useState([]); // Background Music
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [timelineCurrentTime, setTimelineCurrentTime] = useState(0);
  const [selectedClipIndex, setSelectedClipIndex] = useState(null);

  // Refs
  const videoRef = useRef(null);
  const topVideoRef = useRef(null);
  const bottomVideoRef = useRef(null);
  const fileInputRef = useRef(null);
  const promptRef = useRef(null);
  const canvasPanRef = useRef(null);
  const navigate = useNavigate();

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7244/ingest/b7f9bb07-2a1d-4c55-9898-57ec776c5f82', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '057623' },
      body: JSON.stringify({
        sessionId: '057623',
        location: 'VideoEditor.jsx:mount',
        message: 'VideoEditor mounted',
        data: { hasTracks: Array.isArray(timelineTracks), trackCount: timelineTracks?.length ?? 0 },
        timestamp: Date.now(),
        hypothesisId: 'editor_visible',
      }),
    }).catch(() => {});
  }, []);
  // #endregion

  useEffect(() => {
    const onMove = (e) => {
      const pan = canvasPanRef.current;
      if (!pan) return;
      const dx = (e.clientX - pan.startX) / 5;
      const dy = (e.clientY - pan.startY) / 5;
      setSinglePanX((p) => Math.max(-50, Math.min(50, pan.startPanX + dx)));
      setSinglePanY((p) => Math.max(-50, Math.min(50, pan.startPanY + dy)));
    };
    const onUp = () => {
      canvasPanRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const timelineStarts = useMemo(() => computeTimelineStarts(timelineTracks), [timelineTracks]);
  const totalDuration = useMemo(() => getTotalDuration(timelineTracks), [timelineTracks]);
  const getClipIndexAtTime = useCallback(
    (t) => {
      const active = getActiveClipAtTime(timelineTracks, timelineStarts, t);
      return active != null ? active.index : null;
    },
    [timelineTracks, timelineStarts]
  );
  const activeAtCurrentTime = getActiveClipAtTime(timelineTracks, timelineStarts, timelineCurrentTime);
  const previewClipIndex = activeAtCurrentTime?.index ?? null;
  const previewClip = activeAtCurrentTime?.clip ?? null;
  const previewSourceTime = activeAtCurrentTime?.mediaTime ?? 0;
  const currentClipIndexRef = useRef(null);
  if (previewClipIndex != null) currentClipIndexRef.current = previewClipIndex;

  const videoLoadingNewSourceRef = useRef(false);
  const pendingSeekRef = useRef(null);
  useEffect(() => {
    if (timelineTracks.length === 0 || !videoRef.current) return;
    if (previewClip == null) {
      videoRef.current.pause();
      videoLoadingNewSourceRef.current = false;
      pendingSeekRef.current = null;
      return;
    }
    const v = videoRef.current;
    const desiredSrc = (previewClip.url || '').split('?')[0];
    const currentSrc = (v.src || '').split('?')[0];
    const srcMatches = desiredSrc && currentSrc && (currentSrc === desiredSrc || currentSrc.indexOf(desiredSrc) !== -1);
    const needsLoad = !srcMatches || v.readyState < 2;
    if (needsLoad) {
      if (!srcMatches) {
        videoLoadingNewSourceRef.current = true;
        v.src = previewClip.url;
      }
      pendingSeekRef.current = { url: previewClip.url, seekTo: previewSourceTime, playing: isPlayingTimeline };
      const onLoaded = () => {
        const p = pendingSeekRef.current;
        const seekTo = p?.seekTo;
        const playing = p?.playing;
        if (p && (v.src || '').indexOf((p.url || '').split('?')[0]) !== -1) {
          v.currentTime = p.seekTo;
          if (p.playing) v.play().catch(() => {});
        }
        videoLoadingNewSourceRef.current = false;
        pendingSeekRef.current = null;
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/b7f9bb07-2a1d-4c55-9898-57ec776c5f82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'057623'},body:JSON.stringify({sessionId:'057623',location:'VideoEditor.jsx:onLoaded',message:'loadeddata fired',data:{seekTo,playing,readyState:v.readyState},timestamp:Date.now(),hypothesisId:'playback'})}).catch(()=>{});
        // #endregion
      };
      v.addEventListener('loadeddata', onLoaded, { once: true });
      v.addEventListener('error', () => {
        videoLoadingNewSourceRef.current = false;
        pendingSeekRef.current = null;
      }, { once: true });
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/b7f9bb07-2a1d-4c55-9898-57ec776c5f82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'057623'},body:JSON.stringify({sessionId:'057623',location:'VideoEditor.jsx:needsLoad',message:'waiting for loadeddata',data:{previewClipIndex,readyState:v.readyState,srcMatches},timestamp:Date.now(),hypothesisId:'playback'})}).catch(()=>{});
      // #endregion
      return;
    }
    if (videoLoadingNewSourceRef.current) return;
    if (Math.abs(v.currentTime - previewSourceTime) > 0.15) {
      v.currentTime = previewSourceTime;
    }
    if (isPlayingTimeline) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [timelineTracks.length, previewClip?.id, previewClip?.url, previewClipIndex, previewSourceTime, isPlayingTimeline]);

  const timelineCurrentTimeRef = useRef(timelineCurrentTime);
  timelineCurrentTimeRef.current = timelineCurrentTime;

  useEffect(() => {
    if (!isPlayingTimeline || timelineTracks.length === 0) return;
    const id = setInterval(() => {
      setTimelineCurrentTime((prev) => {
        const next = Math.min(totalDuration, prev + 0.05);
        if (next >= totalDuration) setIsPlayingTimeline(false);
        return next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [isPlayingTimeline, timelineTracks.length, totalDuration]);

  // Combined Media List
  const allMedia = [...mediaFiles, ...editedVersions].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const filteredMedia = allMedia.filter((item) => {
    if (activeTab === "all") return true;
    if (activeTab === "video") return item.type === "video" || item.url.endsWith(".mp4");
    if (activeTab === "audio") return item.type === "audio" || item.url.endsWith(".mp3");
    return true;
  });

  const activeMedia = allMedia.find((m) => m.id === activeMediaId);
  const topMedia = allMedia.find((m) => m.id === topVideoId);
  const bottomMedia = allMedia.find((m) => m.id === bottomVideoId);

  // Handlers
  const handleMediaSelect = (mediaId) => {
    if (isSplitScreen) {
      if (activeSlot === 'top' || !topVideoId) {
        setTopVideoId(mediaId);
        setActiveSlot('bottom'); // Auto-advance to bottom slot
      } else {
        setBottomVideoId(mediaId);
        setActiveSlot('top');
      }
    } else {
      setActiveMediaId(mediaId);
    }
  };

  // handleTrimChange (Removed)

  const fetchMedia = async () => {
    try {
      const response = await axios.get("http://127.0.0.1:8001/media");
      if (response.status === 200) {
        const mappedFiles = response.data.map(item => ({
          id: item.filename,
          name: item.filename,
          file: {
            name: item.filename,
            size: item.size != null ? item.size : 0
          },
          url: item.url,
          filename: item.filename,
          type: item.type,
          uploadDate: new Date(item.uploadDate * 1000),
          durationSeconds: item.durationSeconds != null ? item.durationSeconds : null,
          thumbnailUrl: item.thumbnailUrl || null,
          isViralClip: item.isViralClip === true || (typeof item.filename === 'string' && /^version\d+\.mp4$/i.test(item.filename))
        }));
        setMediaFiles(mappedFiles);
        return mappedFiles;
      }
    } catch (error) {
      console.error("Failed to fetch media:", error);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchMedia();
    }
    init();
  }, []);

  const toggleSplitScreen = () => {
    setIsSplitScreen(!isSplitScreen);
    // Reset selection logic
    if (!isSplitScreen) {
      // Switching TO split screen
      setTopVideoId(null);
      setBottomVideoId(null);
    } else {
      // Switching TO single
      setActiveMediaId(null);
    }
  };

  const showToastNotification = (message) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleUpload = async (event) => {
    if (!event.target.files?.length) return;

    const files = Array.from(event.target.files);

    // Check for duplicate filenames
    const existingFilenames = new Set(
      mediaFiles.map((media) => media.file.name)
    );

    const uniqueFiles = files.filter((file) => {
      if (existingFilenames.has(file.name)) {
        showToastNotification(`Duplicate file skipped: ${file.name}`);
        return false;
      }
      return true;
    });

    if (uniqueFiles.length === 0) return;

    // Show loading toast
    showToastNotification("Uploading files...");

    const uploadPromises = uniqueFiles.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await axios.post(
          "http://127.0.0.1:8001/upload",
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          }
        );

        if (response.status === 200) {
          const id = crypto.randomUUID();
          const type = file.type.startsWith("video/") ? "video" : "audio";

          return {
            id,
            file,
            url: URL.createObjectURL(file),
            filename: response.data.filename,
            type,
            uploadDate: new Date(),
          };
        }
      } catch (error) {
        console.error("Upload failed:", error);
        showToastNotification(`Upload failed: ${file.name}`);
        return null;
      }
    });

    const uploadedMediaFiles = (await Promise.all(uploadPromises)).filter(
      Boolean
    );

    if (uploadedMediaFiles.length > 0) {
      setMediaFiles((prev) => [...prev, ...uploadedMediaFiles]);
      showToastNotification(
        `Successfully uploaded ${uploadedMediaFiles.length} files`
      );

      if (!activeMediaId) {
        setActiveMediaId(uploadedMediaFiles[0].id);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleEdit = async () => {
    if (!prompt.trim() || !activeMediaId) return;

    setIsProcessing(true);

    // Find the active media (could be original or a version)
    const activeMedia = allMedia.find((m) => m.id === activeMediaId);
    if (!activeMedia) {
      setIsProcessing(false);
      return;
    }

    // Determine the source for the edit (current view)
    const sourceVersion = activeMedia.versionNumber || activeMedia.filename;

    try {
      showToastNotification("Processing your edit...");

      // Enforce vertical video
      const fullPrompt = prompt + " Ensure the output is a vertical video (9:16 aspect ratio) suitable for TikTok.";

      const response = await axios.post("http://127.0.0.1:8001/query", {
        prompt: fullPrompt,
        video_version: sourceVersion,
      });

      if (response.status === 200 && response.data[0]) {
        // Create a new URL for the edited video
        const newVersionNumber = response.data[1];
        const editedVideoUrl = `http://127.0.0.1:8001/files/version${newVersionNumber}.mp4`;

        // Create a new version object
        const newVersion = {
          id: crypto.randomUUID(),
          prompt,
          timestamp: new Date(),
          mediaId: activeMedia.mediaId || activeMedia.id, // Ensure we link to original ID
          url: editedVideoUrl,
          filename: `version${newVersionNumber}.mp4`, // Store filename for deletion
          versionNumber: `version${newVersionNumber}`,
          type: 'video', // Assuming edits are always video for now
        };

        setEditedVersions((prev) => [...prev, newVersion]);
        setPrompt("");
        showToastNotification("Edit completed successfully!");

        // Switch scope to the new version
        setActiveMediaId(newVersion.id);

        // Force video reload
        if (videoRef.current) {
          videoRef.current.load();
        }
      } else {
        console.error("Editing failed:", response.data);
        const errorMsg = response.data[1] && typeof response.data[1] === 'string'
          ? response.data[1]
          : "Edit failed. Please try again.";
        showToastNotification(errorMsg);
      }
    } catch (error) {
      console.error("Editing failed:", error);
      showToastNotification("Edit failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVersionSelect = (version) => {
    // Set the active media ID to the version ID
    setActiveMediaId(version.id);

    if (videoRef.current) {
      videoRef.current.load();
    }
  };

  const handleDelete = async (id, event) => {
    if (event) event.stopPropagation();

    const media = mediaFiles.find((m) => m.id === id) || editedVersions.find(v => v.id === id);
    if (!media) return;

    // Support deleting versions too
    const filenameToDelete = media.filename || media.versionNumber;

    try {
      await axios.delete(`http://127.0.0.1:8001/delete/${filenameToDelete}`);

      setMediaFiles((prev) => prev.filter((m) => m.id !== id));
      setEditedVersions((prev) => prev.filter((v) => v.id !== id)); // Fix version delete logic

      if (activeMediaId === id) {
        setActiveMediaId(null);
      }
      if (topVideoId === id) setTopVideoId(null);
      if (bottomVideoId === id) setBottomVideoId(null);

      showToastNotification("Media deleted successfully");
    } catch (error) {
      console.error("Delete failed:", error);
      showToastNotification("Failed to delete media");
    }
  };

  const handleAutoGenerate = async (filename, event) => {
    if (event) event.stopPropagation();
    if (isProcessing) return;

    setIsProcessing(true);
    showToastNotification("Starting viral auto-generation... This may take a few minutes.");

    try {
      const response = await axios.post("http://127.0.0.1:8001/auto_generate", {
        filename: filename,
      });

      if (response.status === 200) {
        const files = response.data; // List of file objects or just response
        const count = Array.isArray(files) ? files.length : (files.outputs ? files.outputs.length : 1);
        showToastNotification(`Generated ${count} viral clips successfully!`);
        // Refresh media list to show the new file
        await fetchMedia();
      }
    } catch (error) {
      console.error("Auto-generate failed:", error);
      const msg = error.response?.data?.detail || error.message || "Generation failed. See console for details.";
      showToastNotification(typeof msg === "string" ? msg : "Generation failed.");
    } finally {
      setIsProcessing(false);
    }
  }


  const filteredVersions = activeMediaId
    ? editedVersions.filter((v) => v.mediaId === activeMediaId)
    : [];

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.body.classList.toggle("dark-mode");
  };

  const filteredMediaFiles =
    activeTab === "all"
      ? mediaFiles
      : mediaFiles.filter((media) => media.type === activeTab);

  const handlePromptChange = (e) => {
    const value = e.target.value;
    setPrompt(value);
    const atIndex = value.lastIndexOf("@");
    if (atIndex >= 0) {
      setIsMentioning(true);
      setMentionQuery(value.substring(atIndex + 1));
    } else {
      setIsMentioning(false);
      setMentionQuery("");
    }
  };

  const handlePromptKeyDown = (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      handleEdit();
    } else if (e.key === "Escape" && isMentioning) {
      setIsMentioning(false);
      setMentionQuery("");
      // setSelectedMentionIndex(0); // This state is not defined, remove or define
    } else if (isMentioning && mentionSuggestions.length > 0) {
      // if (e.key === "ArrowDown") {
      //   setSelectedMentionIndex((prev) =>
      //     prev < mentionSuggestions.length - 1 ? prev + 1 : 0
      //   );
      //   e.preventDefault();
      // } else if (e.key === "ArrowUp") {
      //   setSelectedMentionIndex((prev) =>
      //     prev > 0 ? prev - 1 : mentionSuggestions.length - 1
      //   );
      //   e.preventDefault();
      // } else if (e.key === "Tab") {
      //   e.preventDefault();
      //   handleSelectMention(mentionSuggestions[selectedMentionIndex].name);
      // }
    }
  };

  const handleSelectMention = (filename) => {
    const atIndex = prompt.lastIndexOf("@");
    if (atIndex >= 0) {
      const newPrompt = prompt.substring(0, atIndex) + "@" + filename + " ";
      setPrompt(newPrompt);
      setIsMentioning(false);
      setMentionQuery("");
      // setSelectedMentionIndex(0); // This state is not defined, remove or define

      // Focus back on the prompt input
      if (promptRef.current) {
        promptRef.current.focus();
      }
    }
  };

  // Create a combined list of media files and their versions
  const combinedMediaList = [
    ...mediaFiles.map((media) => ({
      id: media.id,
      name: media.file.name,
      type: "media",
      url: media.url,
      filename: media.filename,
    })),
    ...editedVersions.map((version) => ({
      id: version.id,
      name: version.versionNumber,
      type: "version",
      url: version.url,
      filename: version.filename,
    })),
  ];

  const mentionSuggestions = combinedMediaList
    .filter((item) => item.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    .map((item, index) => ({ ...item, index }));

  const formatDate = (date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const resolveClipDurationRef = useRef(new Set());
  useEffect(() => {
    timelineTracks.forEach((clip) => {
      if (clip.type === 'audio' || !clip.url) return;
      if (clip.durationSeconds != null && clip.durationSeconds > 0) return;
      if (resolveClipDurationRef.current.has(clip.timelineId)) return;
      resolveClipDurationRef.current.add(clip.timelineId);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const duration = Math.max(0.1, v.duration);
        resolveClipDurationRef.current.delete(clip.timelineId);
        setTimelineTracks((prev) =>
          prev.map((c) => (c.timelineId === clip.timelineId ? { ...c, endTime: duration } : c))
        );
        v.src = '';
      };
      v.onerror = () => resolveClipDurationRef.current.delete(clip.timelineId);
      v.src = clip.url;
    });
  }, [timelineTracks]);

  const addToTimeline = (mediaItem, targetIndex, explicitSlot) => {
    const durationSec = mediaItem.durationSeconds ?? 10;
    const newItem = {
      ...mediaItem,
      timelineId: crypto.randomUUID(),
      startTime: 0,
      endTime: Math.max(0.1, durationSec),
    };

    if (mediaItem.type === 'audio') {
      setAudioTracks(prev => [...prev, newItem]);
      showToastNotification("Added to Background Music");
      return;
    }

    // Determine target track
    let target = explicitSlot;
    if (!target) {
      if (isSplitScreen) target = activeSlot === 'single' ? 'top' : activeSlot; // default to top if ambiguous in split
      else target = 'single';
    }

    if (target === 'top') {
      setTopTimelineTracks(prev => {
        const newTracks = [...prev];
        const idx = typeof targetIndex === 'number' ? targetIndex : prev.length;
        newTracks.splice(idx, 0, newItem);
        return newTracks;
      });
      showToastNotification(`Added to Top Timeline`);
      // Auto-preview first clip if empty
      if (topTimelineTracks.length === 0) setTopVideoId(mediaItem.id);
    } else if (target === 'bottom') {
      setBottomTimelineTracks(prev => {
        const newTracks = [...prev];
        const idx = typeof targetIndex === 'number' ? targetIndex : prev.length;
        newTracks.splice(idx, 0, newItem);
        return newTracks;
      });
      showToastNotification(`Added to Bottom Timeline`);
      if (bottomTimelineTracks.length === 0) setBottomVideoId(mediaItem.id);
    } else {
      setTimelineTracks(prev => {
        const newTracks = [...prev];
        const idx = typeof targetIndex === 'number' ? targetIndex : prev.length;
        const timelineStart = getTotalDuration(prev);
        const itemWithStart = { ...newItem, timelineStart };
        newTracks.splice(idx, 0, itemWithStart);
        return newTracks;
      });
      showToastNotification(`Added to Timeline`);
      if (timelineTracks.length === 0) setActiveMediaId(mediaItem.id);
    }
  };

  const removeFromTimeline = (index, trackType) => {
    if (trackType === 'top') {
      setTopTimelineTracks(prev => prev.filter((_, i) => i !== index));
    } else if (trackType === 'bottom') {
      setBottomTimelineTracks(prev => prev.filter((_, i) => i !== index));
    } else {
      setTimelineTracks(prev => {
        const next = prev.filter((_, i) => i !== index);
        const newTotal = getTotalDuration(next);
        setTimelineCurrentTime((t) => (newTotal > 0 ? Math.min(t, newTotal) : 0));
        return next;
      });
      setSelectedClipIndex((s) => (s === index ? null : s > index ? s - 1 : s));
    }
  };

  const reorderTimeline = (fromIndex, toIndex, trackType) => {
    const reorder = (prev) => {
      const newTracks = [...prev];
      const [movedItem] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, movedItem);
      return newTracks;
    };

    if (trackType === 'top') setTopTimelineTracks(reorder);
    else if (trackType === 'bottom') setBottomTimelineTracks(reorder);
    else setTimelineTracks(reorder);
  };

  const updateTimelineClip = (index, newClip, trackType) => {
    const updater = (prev) => {
      const newTracks = [...prev];
      newTracks[index] = newClip;
      return newTracks;
    };
    if (trackType === 'top') setTopTimelineTracks(updater);
    else if (trackType === 'bottom') setBottomTimelineTracks(updater);
    else setTimelineTracks(updater);
  };

  const handleClipMoveInTime = (clipIndex, newStartTime) => {
    setTimelineTracks((prev) => {
      if (clipIndex < 0 || clipIndex >= prev.length) return prev;
      const next = [...prev];
      next[clipIndex] = { ...next[clipIndex], timelineStart: Math.max(0, newStartTime) };
      return next;
    });
  };

  const makeRemoveHandler = (type) => (index) => removeFromTimeline(index, type);
  const makeReorderHandler = (type) => (from, to) => reorderTimeline(from, to, type);
  const makeUpdateHandler = (type) => (index, clip) => updateTimelineClip(index, clip, type);

  const makeDropHandler = (type) => (item, index) => {
    const mediaItem = allMedia.find(m => m.id === item.id);
    if (!mediaItem) return;

    if (isSplitScreen) {
      if (type === 'top') setActiveSlot('top');
      else if (type === 'bottom') setActiveSlot('bottom');
    }
    addToTimeline(mediaItem, index);
  };

  const makeClickHandler = (type) => (index, clip) => {
    // Preview the clip in the main player
    if (isSplitScreen) {
      if (type === 'top') {
        setActiveSlot('top');
        setTopVideoId(clip.id); // Valid if clip.id matches original media id
        if (topVideoRef.current) topVideoRef.current.currentTime = clip.startOffset || 0;
      } else {
        setActiveSlot('bottom');
        setBottomVideoId(clip.id);
        if (bottomVideoRef.current) bottomVideoRef.current.currentTime = clip.startOffset || 0;
      }
    } else {
      setActiveMediaId(clip.id);
      if (timelineTracks.length > 0 && timelineStarts[index] != null) {
        handleTimelineSeek(timelineStarts[index]);
      } else if (videoRef.current) {
        videoRef.current.src = clip.url;
        videoRef.current.currentTime = clip.startOffset || 0;
      }
    }
  };

  const handleTrimPreview = (type) => (index, time) => {
    // Seek the relevant video player to 'time' (seconds source time)
    if (type === 'top') {
      if (topVideoRef.current) topVideoRef.current.currentTime = time;
    } else if (type === 'bottom') {
      if (bottomVideoRef.current) bottomVideoRef.current.currentTime = time;
    } else {
      // Single
      if (videoRef.current) videoRef.current.currentTime = time;
    }
  };


  const effectiveSingleTransform = useMemo(() => {
    if (selectedClipIndex != null && selectedClipIndex < timelineTracks.length) {
      const clip = timelineTracks[selectedClipIndex];
      const start = timelineStarts[selectedClipIndex];
      const timeInClip = timelineCurrentTime - start;
      if (clip.keyframes?.length) {
        return getTransformAtTime(clip, timeInClip);
      }
    }
    return {
      positionX: singlePanX,
      positionY: singlePanY,
      scale: singleZoom,
      rotation: singleRotation
    };
  }, [
    selectedClipIndex,
    timelineTracks,
    timelineStarts,
    timelineCurrentTime,
    singleZoom,
    singlePanY,
    singlePanX,
    singleRotation
  ]);

  const handleTimelineSeek = (sequenceTime) => {
    setTimelineCurrentTime(sequenceTime);
    const active = getActiveClipAtTime(timelineTracks, timelineStarts, sequenceTime);
    if (!videoRef.current) return;
    if (active == null) {
      videoRef.current.pause();
      return;
    }
    const sourceTime = active.mediaTime;
    setActiveMediaId(active.clip.id);
    videoRef.current.src = active.clip.url;
    videoRef.current.currentTime = sourceTime;
  };

  const handleAddKeyframe = () => {
    const clipIndexAtPlayhead = getClipIndexAtTime(timelineCurrentTime);
    const clipIndex = (selectedClipIndex != null && selectedClipIndex < timelineTracks.length)
      ? selectedClipIndex
      : clipIndexAtPlayhead;
    if (clipIndex == null || clipIndex >= timelineTracks.length) return;
    const clip = timelineTracks[clipIndex];
    const start = timelineStarts[clipIndex];
    const tInClip = timelineCurrentTime - start;
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const duration = outPoint - inPoint;
    if (tInClip < -0.01 || tInClip > duration + 0.01) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/b7f9bb07-2a1d-4c55-9898-57ec776c5f82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'057623'},body:JSON.stringify({sessionId:'057623',location:'VideoEditor.jsx:handleAddKeyframe',message:'early return tInClip',data:{tInClip,duration},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      return;
    }
    const value = {
      positionX: singlePanX,
      positionY: singlePanY,
      scale: singleZoom,
      rotation: singleRotation
    };
    const kfs = [...(clip.keyframes || []), { t: Math.max(0, Math.min(duration, tInClip)), value }].sort(
      (a, b) => a.t - b.t
    );
    setTimelineTracks((prev) => {
      const next = [...prev];
      next[clipIndex] = { ...clip, keyframes: kfs };
      return next;
    });
  };

  const handleKeyframeMove = (clipIndex, keyframeIndex, newT) => {
    setTimelineTracks((prev) => {
      const next = [...prev];
      const clip = next[clipIndex];
      const kfs = [...(clip.keyframes || [])];
      if (!kfs[keyframeIndex]) return prev;
      const inPoint = clip.startTime ?? 0;
      const outPoint = clip.endTime ?? 10;
      const duration = outPoint - inPoint;
      kfs[keyframeIndex] = { ...kfs[keyframeIndex], t: Math.max(0, Math.min(duration, newT)) };
      kfs.sort((a, b) => a.t - b.t);
      next[clipIndex] = { ...clip, keyframes: kfs };
      return next;
    });
  };

  const handleSplitSingle = () => {
    const idx = getClipIndexAtTime(timelineCurrentTime);
    if (idx == null) return;
    const clip = timelineTracks[idx];
    const start = timelineStarts[idx];
    const inPoint = clip.startTime ?? 0;
    const outPoint = clip.endTime ?? 10;
    const splitSourceTime = inPoint + (timelineCurrentTime - start);
    if (splitSourceTime <= inPoint + 0.1 || splitSourceTime >= outPoint - 0.1) return;
    const firstEnd = start + (splitSourceTime - inPoint);
    const first = { ...clip, endTime: splitSourceTime };
    const second = {
      ...clip,
      timelineId: crypto.randomUUID(),
      startTime: splitSourceTime,
      endTime: outPoint,
      timelineStart: firstEnd,
      startOffset: (clip.startOffset ?? 0) + (splitSourceTime - inPoint)
    };
    setTimelineTracks((prev) => {
      const next = [...prev];
      next.splice(idx, 1, first, second);
      return next;
    });
    setSelectedClipIndex(idx + 1);
  };

  const togglePlayPause = () => {
    if (isPlayingTimeline) {
      setIsPlayingTimeline(false);
      return;
    }
    if (timelineTracks.length === 0) return;
    setIsPlayingTimeline(true);
  };

  const playTimeline = () => {
    if (timelineTracks.length === 0) return;
    setTimelineCurrentTime(0);
    setIsPlayingTimeline(true);
  };

  const handleVideoEnded = () => {
    if (!isPlayingTimeline) return;
    const idx = currentClipIndexRef.current;
    if (idx == null || idx < 0 || idx >= timelineTracks.length) return;
    const clip = timelineTracks[idx];
    const start = timelineStarts[idx];
    const dur = (clip.endTime ?? 10) - (clip.startTime ?? 0);
    const clipEndTime = start + dur;
    if (clipEndTime >= totalDuration) {
      setTimelineCurrentTime(totalDuration);
      setIsPlayingTimeline(false);
      return;
    }
    setTimelineCurrentTime(clipEndTime);
  };

  const handleTimeUpdate = () => {
    if (!isPlayingTimeline || !videoRef.current) return;
    const idx = currentClipIndexRef.current;
    if (idx == null || idx >= timelineTracks.length) return;
    const clip = timelineTracks[idx];
    const endTime = clip?.endTime ?? 10;
    if (videoRef.current.currentTime >= endTime) handleVideoEnded();
  };

  const exportTimeline = async () => {
    let clipsToRender = {};
    const endpoint = "http://127.0.0.1:8001/" + (isSplitScreen ? "render_split_timeline" : "render_timeline");

    const formatAudioClip = (t) => ({
      filename: t.filename || t.name,
      start: t.startTime ?? 0,
      end: t.endTime ?? 10
    });

    if (isSplitScreen) {
      if (topTimelineTracks.length === 0 && bottomTimelineTracks.length === 0) {
        showToastNotification("No clips in either timeline to export.");
        return;
      }
      clipsToRender = {
        top_clips: tracksToExportClips(topTimelineTracks),
        bottom_clips: tracksToExportClips(bottomTimelineTracks),
        audio_clips: audioTracks.map(formatAudioClip),
        top_zoom: topZoom,
        top_pan_y: topPanY,
        bottom_zoom: bottomZoom,
        bottom_pan_y: bottomPanY
      };
    } else {
      if (timelineTracks.length === 0) {
        showToastNotification("No clips in timeline to export.");
        return;
      }
      const clips = tracksToExportClips(timelineTracks);
      clips.forEach((c, i) => {
        const tf = getTransformAtTime(timelineTracks[i], 0);
        c.position_x = tf.positionX;
        c.position_y = tf.positionY;
        c.scale = tf.scale;
        c.rotation = tf.rotation;
      });
      clipsToRender = { clips };
    }

    setIsProcessing(true);
    showToastNotification("Rendering…");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clipsToRender)
      });

      const contentType = response.headers.get("content-type") || "";
      if (response.ok && (contentType.includes("video/mp4") || contentType.includes("application/octet-stream"))) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "TikTok_export.mp4";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToastNotification("Downloaded");
      } else {
        let message = "Timeline export failed";
        if (!response.ok) {
          try {
            const errBody = await response.text();
            const parsed = errBody.startsWith("{") ? JSON.parse(errBody) : null;
            if (parsed?.detail) message = parsed.detail;
          } catch (_) { /* ignore */ }
        }
        showToastNotification(message);
      }
    } catch (error) {
      console.error("Timeline export failed:", error);
      showToastNotification("Timeline export failed");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`video-editor ${isDarkMode ? "dark-mode" : ""}`}>
      {/* Processing Overlay */}
      {isProcessing && (
        <div className="processing-overlay fade-in">
          <div className="processing-content">
            <div className="processing-spinner"></div>
            <h3>Processing Video...</h3>
            <p>This may take a minute depending on the edit complexity.</p>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewMedia && (
        <div className="modal-overlay fade-in" onClick={() => setPreviewMedia(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreviewMedia(null)}>×</button>
            <h3 style={{ marginBottom: '1rem', color: 'white' }}>Preview Media</h3>
            <div className="modal-video-container">
              {previewMedia.type === 'audio' ? (
                <div className="modal-audio-preview">
                  <Volume2 size={64} style={{ marginBottom: '1rem', color: 'var(--color-tiktok-cyan)' }} />
                  <div style={{ fontSize: '1.2rem' }}>{previewMedia.name}</div>
                </div>
              ) : (
                <video
                  src={previewMedia.url}
                  controls
                  autoPlay
                  className="modal-video-player"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>
            <div className="modal-actions">
              {isSplitScreen ? (
                <>
                  <button className="button primary" onClick={() => { addToTimeline(previewMedia, null, 'top'); setPreviewMedia(null); }}>
                    Add to Top Screen
                  </button>
                  <button className="button primary" onClick={() => { addToTimeline(previewMedia, null, 'bottom'); setPreviewMedia(null); }}>
                    Add to Bottom Screen
                  </button>
                </>
              ) : (
                <button className="button primary" onClick={() => { addToTimeline(previewMedia, null, 'single'); setPreviewMedia(null); }}>
                  Add to Timeline
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {showToast && (
        <div className="toast-notification fade-in">
          <div className="toast-content">
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <div className="sidebar left-sidebar">
        <div className="sidebar-header">
          <h2>Media Library</h2>
        </div>
        <div className="sidebar-content">
          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              All
            </button>
            <button
              className={`tab ${activeTab === "video" ? "active" : ""}`}
              onClick={() => setActiveTab("video")}
            >
              Videos
            </button>
            <button
              className={`tab ${activeTab === "audio" ? "active" : ""}`}
              onClick={() => setActiveTab("audio")}
            >
              Audio
            </button>
          </div>

          <div className="media-list">
            {filteredMedia.map((media) => {
              const isActive = (activeMediaId === media.id) || (topVideoId === media.id) || (bottomVideoId === media.id);

              return (
                <div
                  key={media.id}
                  className={`media-item ${isActive ? "active" : ""}`}
                  onClick={() => setPreviewMedia(media)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify(media));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <div className="media-thumbnail">
                    {media.type === "audio" ? (
                      <Volume2 size={24} />
                    ) : media.thumbnailUrl ? (
                      <img
                        src={media.thumbnailUrl}
                        alt=""
                        width="50"
                        height="50"
                        style={{ objectFit: 'cover', borderRadius: '4px' }}
                      />
                    ) : (
                      <video
                        src={media.url}
                        className="media-thumb-video"
                        muted
                        preload="metadata"
                        onMouseOver={e => e.target.play().catch(() => { })}
                        onMouseOut={e => { e.target.pause(); e.target.currentTime = 0; }}
                        width="50"
                        height="50"
                        style={{ objectFit: 'cover', borderRadius: '4px' }}
                      />
                    )}
                  </div>
                  <div className="media-details">
                    <div className="media-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {media.name || media.versionNumber}
                      {media.isViralClip && (
                        <span className="viral-badge" style={{ fontSize: '0.7rem', background: 'rgba(254, 44, 85, 0.25)', color: '#fe2c55', padding: '2px 6px', borderRadius: '10px', fontWeight: 600 }}>Viral clip</span>
                      )}
                    </div>
                    <div className="media-meta">
                      <span className="file-size">
                        {media.file?.size
                          ? (media.file.size / (1024 * 1024)).toFixed(2) + " MB"
                          : "0.00 MB"}
                      </span>
                      {media.durationSeconds != null && (
                        <span className="file-duration" style={{ marginLeft: '6px' }}>
                          {media.durationSeconds < 60
                            ? `${Math.round(media.durationSeconds)} sec`
                            : `${Math.floor(media.durationSeconds / 60)}:${String(Math.round(media.durationSeconds % 60)).padStart(2, '0')}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="media-actions" style={{ display: 'flex', gap: '4px' }}>
                    {media.type !== 'audio' && !media.isViralClip && (
                      <button
                        className="action-button viral-btn"
                        onClick={(e) => handleAutoGenerate(media.filename || media.name, e)}
                        title="Generate viral clips from this video"
                        style={{
                          padding: '6px 12px',
                          background: '#fe2c55',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          borderRadius: '20px',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 8px rgba(254, 44, 85, 0.4)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <Zap size={18} fill="currentColor" /> Create TikTok Video
                      </button>
                    )}
                    <button
                      className="delete-button"
                      onClick={(e) => handleDelete(media.id, e)}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="upload-section" style={{ padding: '1rem' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUpload}
            className="hidden"
            multiple
            accept="video/*,audio/*"
          />
          <button
            className="button outline upload-button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} /> UPLOAD MEDIA
          </button>
        </div>
      </div>

      <div className="editor-main">
        <div className="editor-header">
          <h1>
            <img src={logo || "/placeholder.svg"} alt="TikTok Genie" className="logo" />
            <span>TikTok Genie</span>
          </h1>
          <div className="view-controls">
            <button
              className="button outline"
              onClick={() => navigate('/thumbnail')}
              title="Create Thumbnail"
            >
              <Wand2 size={16} /> Thumbnail
            </button>
            <button className={`button ${isSplitScreen ? 'primary' : 'outline'}`} onClick={toggleSplitScreen}>
              {isSplitScreen ? 'Split View' : 'Single View'}
            </button>
          </div>
        </div>

        <div className="editor-content">
          {/* Phone Frame Container */}
          <div className="phone-frame">
            {isSplitScreen ? (
              <div className="split-container">
                <div
                  className={`split-slot top-slot ${activeSlot === 'top' ? 'selected-slot' : ''}`}
                  onClick={() => setActiveSlot('top')}
                >
                  {topMedia ? (
                    <video
                      src={topMedia.url}
                      className="video-player"
                      controls
                      playsInline
                      ref={topVideoRef}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${topZoom}) translateY(${topPanY}%)` }}
                    />
                  ) : (
                    <div className="empty-slot">Select Top Video</div>
                  )}
                </div>
                <div
                  className={`split-slot bottom-slot ${activeSlot === 'bottom' ? 'selected-slot' : ''}`}
                  onClick={() => setActiveSlot('bottom')}
                >
                  {bottomMedia ? (
                    <video
                      src={bottomMedia.url}
                      className="video-player"
                      controls
                      playsInline
                      ref={bottomVideoRef}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${bottomZoom}) translateY(${bottomPanY}%)` }}
                    />
                  ) : (
                    <div className="empty-slot">Select Bottom Video</div>
                  )}
                </div>
              </div>
            ) : timelineTracks.length > 0 ? (
              /* Timeline-driven preview: clip at current time or black */
              <div className="single-container canvas-9-16">
                <div
                  className="canvas-video-wrap"
                  onMouseDown={(e) => {
                    if (e.target.closest('video')) canvasPanRef.current = { startX: e.clientX, startY: e.clientY, startPanX: singlePanX, startPanY: singlePanY };
                  }}
                >
                  <video
                    ref={videoRef}
                    src={previewClip?.url ?? ''}
                    className="video-player"
                    controls
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleVideoEnded}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: previewClip ? 1 : 0,
                      transform: `scale(${effectiveSingleTransform.scale}) translate(${effectiveSingleTransform.positionX}%, ${effectiveSingleTransform.positionY}%) rotate(${effectiveSingleTransform.rotation}deg)`
                    }}
                  />
                  {!previewClip && (
                    <div className="canvas-black" style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
                  )}
                </div>
                {showSafeArea && (
                  <div className="safe-area-overlay" aria-hidden>
                    <div className="safe-area-inner" />
                  </div>
                )}
              </div>
            ) : (
              /* No timeline clips: empty canvas (deleting last clip must clear preview) */
              <div className="empty-preview">
                <Video size={48} />
                <h3>No Video Selected</h3>
                <p>Add clips to the timeline to start editing</p>
              </div>
            )}
          </div>

          {/* Zoom & Pan Controls */}
          <div className="zoom-control" style={{ margin: '0 auto 1rem auto', padding: '1rem', background: 'var(--color-card)', borderRadius: '8px', width: '100%', maxWidth: '400px' }}>

            {isSplitScreen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Top Controls */}
                <div>
                  <div style={{ borderBottom: '1px solid #333', paddingBottom: '0.5rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>Top Video Controls</div>

                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <label className="section-label" style={{ marginBottom: 0, fontSize: '0.75rem', color: '#ccc' }}>Zoom</label>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>{topZoom.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range" min="0.5" max="3" step="0.05"
                      value={topZoom}
                      onChange={(e) => setTopZoom(parseFloat(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <label className="section-label" style={{ marginBottom: 0, fontSize: '0.75rem', color: '#ccc' }}>Vertical Position</label>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>{topPanY}%</span>
                    </div>
                    <input
                      type="range" min="-50" max="50" step="1"
                      value={topPanY}
                      onChange={(e) => setTopPanY(parseFloat(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Bottom Controls */}
                <div>
                  <div style={{ borderBottom: '1px solid #333', paddingBottom: '0.5rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>Bottom Video Controls</div>

                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <label className="section-label" style={{ marginBottom: 0, fontSize: '0.75rem', color: '#ccc' }}>Zoom</label>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>{bottomZoom.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range" min="0.5" max="3" step="0.05"
                      value={bottomZoom}
                      onChange={(e) => setBottomZoom(parseFloat(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <label className="section-label" style={{ marginBottom: 0, fontSize: '0.75rem', color: '#ccc' }}>Vertical Position</label>
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>{bottomPanY}%</span>
                    </div>
                    <input
                      type="range" min="-50" max="50" step="1"
                      value={bottomPanY}
                      onChange={(e) => setBottomPanY(parseFloat(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="button small outline" onClick={() => { setTopZoom(1); setTopPanY(0); setBottomZoom(1); setBottomPanY(0); }}>Reset All</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label className="section-label" style={{ marginBottom: 0 }}>Video Zoom</label>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{singleZoom.toFixed(2)}x</span>
                </div>
                <input
                  type="range" min="0.5" max="3" step="0.05"
                  value={singleZoom}
                  onChange={(e) => setSingleZoom(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer', marginBottom: '1rem' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label className="section-label" style={{ marginBottom: 0 }}>Vertical Position</label>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{singlePanY}%</span>
                </div>
                <input
                  type="range" min="-50" max="50" step="1"
                  value={singlePanY}
                  onChange={(e) => setSinglePanY(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer', marginBottom: '1rem' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label className="section-label" style={{ marginBottom: 0 }}>Horizontal Position</label>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{singlePanX}%</span>
                </div>
                <input
                  type="range" min="-50" max="50" step="1"
                  value={singlePanX}
                  onChange={(e) => setSinglePanX(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer', marginBottom: '1rem' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label className="section-label" style={{ marginBottom: 0 }}>Rotation</label>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{singleRotation}°</span>
                </div>
                <input
                  type="range" min="-180" max="180" step="1"
                  value={singleRotation}
                  onChange={(e) => setSingleRotation(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                  <label className="section-label" style={{ marginBottom: 0 }}>Safe area</label>
                  <button
                    type="button"
                    className={`button small ${showSafeArea ? 'primary' : 'outline'}`}
                    onClick={() => setShowSafeArea((s) => !s)}
                  >
                    {showSafeArea ? 'On' : 'Off'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                  <button className="button small outline" onClick={() => { setSingleZoom(1); setSinglePanY(0); setSinglePanX(0); setSingleRotation(0); }}>Reset</button>
                  <button
                    className="button small primary"
                    onClick={handleAddKeyframe}
                    disabled={getClipIndexAtTime(timelineCurrentTime) == null}
                    title="Add keyframe at playhead (current zoom/pan). Uses clip under playhead if none selected."
                  >
                    <Plus size={14} /> Add Keyframe
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Trimmer UI (Removed) */}

          {/* Timeline Section */}
          <div className="timelines-wrapper" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
            {isSplitScreen ? (
              <>
                <h4 className="track-label" style={{ color: '#888', marginBottom: '0.5rem' }}>Top Screen Timeline</h4>
                <Timeline
                  tracks={topTimelineTracks}
                  onRemoveClip={makeRemoveHandler('top')}
                  onReorderClips={makeReorderHandler('top')}
                  onClipUpdate={makeUpdateHandler('top')}
                  onClipClick={makeClickHandler('top')}
                  onTrimPreview={handleTrimPreview('top')}
                  onPlayTimeline={() => { }}
                  onClipDrop={makeDropHandler('top')}
                  totalDuration={60}
                />

                <h4 className="track-label" style={{ color: '#888', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Bottom Screen Timeline</h4>
                <Timeline
                  tracks={bottomTimelineTracks}
                  onRemoveClip={makeRemoveHandler('bottom')}
                  onReorderClips={makeReorderHandler('bottom')}
                  onClipUpdate={makeUpdateHandler('bottom')}
                  onClipClick={makeClickHandler('bottom')}
                  onTrimPreview={handleTrimPreview('bottom')}
                  onPlayTimeline={() => { }}
                  onClipDrop={makeDropHandler('bottom')}
                  totalDuration={60}
                />

                <h4 className="track-label" style={{ color: '#888', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Background Music</h4>
                <Timeline
                  tracks={audioTracks}
                  onRemoveClip={(index) => setAudioTracks(prev => prev.filter((_, i) => i !== index))}
                  onReorderClips={(from, to) => {
                    const updated = [...audioTracks];
                    const [moved] = updated.splice(from, 1);
                    updated.splice(to, 0, moved);
                    setAudioTracks(updated);
                  }}
                  onClipUpdate={(index, newClip) => {
                    const updated = [...audioTracks];
                    updated[index] = newClip;
                    setAudioTracks(updated);
                  }}
                  onClipClick={() => { }}
                  onPlayTimeline={() => { }}
                  onClipDrop={(item, index) => {
                    if (item.type !== 'audio') return;
                    const newItem = { ...item, id: Date.now(), startTime: 0, endTime: 10, startOffset: 0 };
                    const updated = [...audioTracks];
                    updated.splice(typeof index === 'number' ? index : updated.length, 0, newItem);
                    setAudioTracks(updated);
                  }}
                  totalDuration={60}
                />
              </>
            ) : (
              // Single View
              <>
                <Timeline
                  tracks={timelineTracks}
                  onRemoveClip={makeRemoveHandler('single')}
                  onReorderClips={makeReorderHandler('single')}
                  onClipUpdate={makeUpdateHandler('single')}
                  onClipClick={makeClickHandler('single')}
                  onTrimPreview={handleTrimPreview('single')}
                  onPlayTimeline={playTimeline}
                  onClipDrop={makeDropHandler('single')}
                  onClipMoveInTime={handleClipMoveInTime}
                  totalDuration={timelineTracks.length ? undefined : 60}
                  currentTime={timelineCurrentTime}
                  onSeek={handleTimelineSeek}
                  onSplitAtPlayhead={handleSplitSingle}
                  selectedClipIndex={selectedClipIndex}
                  onSelectClip={setSelectedClipIndex}
                  isPlaying={isPlayingTimeline}
                  onPlayPause={togglePlayPause}
                  onKeyframeAdd={handleAddKeyframe}
                  onKeyframeMove={handleKeyframeMove}
                />
                {/* Optional: Add Audio Track to Single View too if needed, but user focused on Split */}
              </>
            )}
          </div>

          <div className="timeline-actions" style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <button className="button primary" onClick={exportTimeline} disabled={isProcessing || (isSplitScreen ? (topTimelineTracks.length === 0 && bottomTimelineTracks.length === 0) : timelineTracks.length === 0)}>
              EXPORT {isSplitScreen ? 'SPLIT VIDEO' : 'TIMELINE'}
            </button>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Chat & History */}
      <div className="sidebar right-sidebar">
        <div className="sidebar-header">
          <h2>AI Editor</h2>
        </div>

        <div className="sidebar-content" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>



          {/* Prompt Section */}
          <div className="prompt-section">
            <label className="section-label">Editing Prompt</label>
            <div className="prompt-container">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={handlePromptChange}
                onKeyDown={handlePromptKeyDown}
                placeholder="Describe how you want to edit this video..."
                className="prompt-textarea"
                disabled={isProcessing}
              />
              <div className="prompt-actions">
                <button
                  className="button primary"
                  onClick={handleEdit}
                  disabled={isProcessing || !prompt.trim()}
                >
                  {isProcessing ? (
                    <>
                      <div className="spinner-small"></div> Processing...
                    </>
                  ) : (
                    <>
                      <Wand2 size={16} /> APPLY AI EDIT
                    </>
                  )}
                </button>
              </div>

              {isMentioning && (
                <div className="mention-suggestions">
                  {mentionSuggestions.map((item, index) => (
                    <div
                      key={item.index}
                      className={`mention-item ${index === selectedMentionIndex ? "selected" : ""
                        }`}
                      onClick={() => handleSelectMention(item.name)}
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Edit History moved here */}
          <div className="history-section">
            <h3>Edit History</h3>
            {filteredVersions.length === 0 ? (
              <div className="empty-history">
                <p>No edits yet</p>
                <span className="sub-text">Use the prompt to create edited versions</span>
              </div>
            ) : (
              <div className="versions-list">
                {filteredVersions.map((version) => (
                  <div
                    key={version.id}
                    className={`version-item ${activeMediaId === version.id ? 'active' : ''}`}
                    onClick={() => handleVersionSelect(version)}
                  >
                    <div className="version-info">
                      <span className="version-name">{version.versionNumber}</span>
                      <span className="version-date">{formatDate(new Date(version.timestamp))}</span>
                    </div>
                    <div className="version-prompt">"{version.prompt}"</div>
                    <div className="version-actions">
                      <button
                        className="button small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToTimeline(version);
                        }}
                        title="Add to Timeline"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoEditor;
