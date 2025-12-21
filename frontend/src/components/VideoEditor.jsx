import { useState, useRef, useEffect } from "react";
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

  // Timeline State
  const [timelineTracks, setTimelineTracks] = useState([]); // For Single view
  const [topTimelineTracks, setTopTimelineTracks] = useState([]); // For Split Top
  const [bottomTimelineTracks, setBottomTimelineTracks] = useState([]); // For Split Bottom
  const [audioTracks, setAudioTracks] = useState([]); // Background Music
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);
  const [currentTimelineIndex, setCurrentTimelineIndex] = useState(0);

  // Refs
  const videoRef = useRef(null);
  const topVideoRef = useRef(null);
  const bottomVideoRef = useRef(null);
  const fileInputRef = useRef(null);
  const promptRef = useRef(null);
  const navigate = useNavigate();

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
          name: item.filename, // Added name property
          file: {
            name: item.filename,
            size: 0
          },
          url: item.url,
          filename: item.filename,
          type: item.type,
          uploadDate: new Date(item.uploadDate * 1000)
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
      showToastNotification("Generation failed. See console for details.");
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

  // Timeline Functions
  const addToTimeline = (mediaItem, targetIndex, explicitSlot) => {
    // Default to 10s or 0 if unknown duration. 
    // Ideally we should know duration. Media item might not have it unless we pre-loaded metadata.
    // For now we default to 10s as per previous logic.
    const newItem = {
      ...mediaItem,
      timelineId: crypto.randomUUID(),
      startTime: 0,
      endTime: 10,
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
        newTracks.splice(idx, 0, newItem);
        return newTracks;
      });
      showToastNotification(`Added to Timeline`);
      // Auto-preview first clip if empty
      if (timelineTracks.length === 0) setActiveMediaId(mediaItem.id);
    }
  };

  const removeFromTimeline = (index, trackType) => {
    if (trackType === 'top') {
      setTopTimelineTracks(prev => prev.filter((_, i) => i !== index));
    } else if (trackType === 'bottom') {
      setBottomTimelineTracks(prev => prev.filter((_, i) => i !== index));
    } else {
      setTimelineTracks(prev => prev.filter((_, i) => i !== index));
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
      if (videoRef.current) {
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


  const playTimeline = () => {
    if (timelineTracks.length === 0) return;

    setIsPlayingTimeline(true);
    setCurrentTimelineIndex(0);

    // Start playing the first clip
    if (videoRef.current) {
      const clip = timelineTracks[0];
      videoRef.current.src = clip.url;
      videoRef.current.currentTime = clip.startTime || 0;
      setTimeout(() => {
        videoRef.current.play();
      }, 100);
    }
  };

  const handleVideoEnded = () => {
    if (isPlayingTimeline) {
      const currentClip = timelineTracks[currentTimelineIndex];
      // Check if we hit the end trim of current clip? 
      // HTML Video 'ended' event only fires at end of file. 
      // We need 'timeupdate' to enforce end trim.
      // But for now, let's assume end trim = file end, or user is just previewing.

      if (currentTimelineIndex < timelineTracks.length - 1) {
        // Play next clip
        const nextIndex = currentTimelineIndex + 1;
        setCurrentTimelineIndex(nextIndex);
        const nextClip = timelineTracks[nextIndex];
        videoRef.current.src = nextClip.url;
        videoRef.current.currentTime = nextClip.startTime || 0;
        setTimeout(() => {
          videoRef.current.play();
        }, 100);
      } else {
        // End of timeline
        setIsPlayingTimeline(false);
        setCurrentTimelineIndex(0);
      }
    }
  };

  // Enforce trim end during playback
  const handleTimeUpdate = () => {
    if (isPlayingTimeline && videoRef.current) {
      const currentClip = timelineTracks[currentTimelineIndex];
      if (currentClip && currentClip.endTime && videoRef.current.currentTime >= currentClip.endTime) {
        // Move to next clip
        handleVideoEnded();
      }
    }
  };

  const exportTimeline = async () => {
    let clipsToRender = [];
    let endpoint = "render_timeline"; // Default for single timeline

    const formatClip = (t) => ({
      filename: t.filename || t.name,
      start: t.startTime || 0,
      end: t.endTime || 10 // defaults
    });

    if (isSplitScreen) {
      if (topTimelineTracks.length === 0 && bottomTimelineTracks.length === 0) {
        showToastNotification("No clips in either timeline to export.");
        return;
      }
      endpoint = "render_split_timeline";
      clipsToRender = {
        top_clips: topTimelineTracks.map(formatClip),
        bottom_clips: bottomTimelineTracks.map(formatClip),
        audio_clips: audioTracks.map(formatClip),
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
      clipsToRender = {
        clips: timelineTracks.map(formatClip)
      };
    }

    setIsProcessing(true);
    showToastNotification("Rendering timeline...");

    try {
      const response = await axios.post(`http://127.0.0.1:8001/${endpoint}`, clipsToRender);

      if (response.status === 200) {
        const newFilename = response.data.filename;
        showToastNotification(`Timeline rendered: ${newFilename}`);

        // Optionally, fetch media again to show the new rendered file
        // await fetchMedia();
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
                    <div className="media-name">{media.name || media.versionNumber}</div>
                    <div className="media-meta">
                      <span className="file-size">
                        {media.file?.size
                          ? (media.file.size / (1024 * 1024)).toFixed(2) + " MB"
                          : "0.00 MB"}
                      </span>
                    </div>
                  </div>
                  <div className="media-actions" style={{ display: 'flex', gap: '4px' }}>
                    {media.type !== 'audio' && (
                      <button
                        className="action-button viral-btn"
                        onClick={(e) => handleAutoGenerate(media.filename || media.name, e)}
                        title="Auto-Generate Viral Clip"
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
            ) : (
              activeMedia ? (
                <div className="single-container">
                  <video
                    ref={videoRef}
                    src={activeMedia.url}
                    className="video-player"
                    controls
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleVideoEnded}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${singleZoom}) translateY(${singlePanY}%)` }}
                  />
                </div>
              ) : (
                <div className="empty-preview">
                  <Video size={48} />
                  <h3>No Video Selected</h3>
                  <p>Select a video from the library to start editing</p>
                </div>
              )
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
                  style={{ width: '100%', cursor: 'pointer' }}
                />

                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                  <button className="button small outline" onClick={() => { setSingleZoom(1); setSinglePanY(0); }}>Reset</button>
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
                  totalDuration={60}
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
