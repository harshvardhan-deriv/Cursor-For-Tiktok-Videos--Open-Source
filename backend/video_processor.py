
import os
import subprocess
from pydantic import BaseModel
from typing import List, Optional

# Define global constants
FILES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "files")
if not os.path.exists(FILES_DIR):
    os.makedirs(FILES_DIR)


class ClipData(BaseModel):
    """Source clip for timeline. start/end are source in/out (backward compat). Optional in/out override; optional timeline_start for ordering; optional transform."""
    filename: str
    start: float = 0.0
    end: float = 10.0
    in_point: Optional[float] = None
    out_point: Optional[float] = None
    timeline_start: Optional[float] = None
    position_x: Optional[float] = None  # pan X percent (-50 to 50)
    position_y: Optional[float] = None  # pan Y percent (-50 to 50)
    scale: Optional[float] = None       # zoom factor (e.g. 1.0)
    rotation: Optional[float] = None   # degrees


class SplitTimelineRequest(BaseModel):
    top_clips: List[ClipData]
    bottom_clips: List[ClipData]
    audio_clips: List[ClipData] = []
    top_zoom: float = 1.0
    top_pan_y: float = 0.0
    bottom_zoom: float = 1.0
    bottom_pan_y: float = 0.0


def _has_audio_stream(filepath: str) -> bool:
    """Return True if the file has at least one audio stream."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", filepath],
            capture_output=True, text=True, timeout=10
        )
        return out.returncode == 0 and out.stdout is not None and "audio" in out.stdout
    except (subprocess.TimeoutExpired, OSError):
        return False


def _clip_video_filter(idx: int, clip: ClipData, ts: float, te: float) -> str:
    """Build video filter for one clip: trim, scale/crop with optional transform (pan, zoom, rotate). Output is 1080x1920."""
    zoom_val = clip.scale if clip.scale is not None else 1.0
    pos_x = clip.position_x if clip.position_x is not None else 0.0
    pos_y = clip.position_y if clip.position_y is not None else 0.0
    rot = clip.rotation if clip.rotation is not None else 0.0
    w = max(1080, int(1080 * zoom_val))
    h = max(1920, int(1920 * zoom_val))
    chain = f"[{idx}:v]trim=start={ts}:end={te},setpts=PTS-STARTPTS"
    chain += f",scale={w}:{h}:force_original_aspect_ratio=increase"
    px = int((pos_x / 100.0) * 1080)
    py = int((pos_y / 100.0) * 1920)
    chain += f",crop=1080:1920:(iw-1080)/2-{px}:(ih-1920)/2-{py}"
    if rot != 0:
        import math
        rad = rot * math.pi / 180
        chain += f",rotate={rad}:c=black"
        chain += ",scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black"
    chain += ",setsar=1"
    return chain + f"[v{idx}]"


def _safe_export_basename() -> str:
    """Return a unique safe basename for export (e.g. export_20250220_143022.mp4)."""
    from datetime import datetime
    return f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"


def render_timeline_clips(clips: List[ClipData], output_filename: Optional[str] = None) -> str:
    """
    Render a list of clips (trim + vertical 1080x1920) into a single output file.
    If output_filename is None, uses version{N+1}.mp4. Otherwise uses the given basename (no path).
    Returns the output filename.
    """
    if not clips:
        raise ValueError("No clips provided")
    n = len(clips)
    if output_filename is None:
        num_files = len([f for f in os.listdir(FILES_DIR) if f.startswith("version") and f.endswith(".mp4")])
        output_filename = f"version{num_files+1}.mp4"
    else:
        output_filename = os.path.basename(output_filename)
        if not output_filename.endswith(".mp4"):
            output_filename += ".mp4"
    output_path = os.path.join(FILES_DIR, output_filename)

    # Optional: sort by timeline_start so export order matches timeline order
    if any(c.timeline_start is not None for c in clips):
        clips = sorted(clips, key=lambda c: (c.timeline_start if c.timeline_start is not None else 0.0))

    def trim_start(c: ClipData) -> float:
        return c.in_point if c.in_point is not None else c.start
    def trim_end(c: ClipData) -> float:
        return c.out_point if c.out_point is not None else c.end

    clip_paths = []
    has_audio = []
    for clip in clips:
        filename = clip.filename
        if filename.startswith("version") and not filename.endswith(".mp4"):
            filename += ".mp4"
        path = os.path.join(FILES_DIR, filename)
        clip_paths.append(path)
        has_audio.append(_has_audio_stream(path))

    inputs = []
    for path in clip_paths:
        inputs.extend(["-i", path])
    for i, clip in enumerate(clips):
        dur = max(0.001, trim_end(clip) - trim_start(clip))
        if not has_audio[i]:
            inputs.extend(["-f", "lavfi", "-t", str(dur), "-i", "anullsrc=r=44100:cl=stereo"])

    filter_parts = []
    next_silence = n
    for i, clip in enumerate(clips):
        ts, te = trim_start(clip), trim_end(clip)
        vf = _clip_video_filter(i, clip, ts, te)
        filter_parts.append(vf + ";")
        if has_audio[i]:
            filter_parts.append(f"[{i}:a]atrim=start={ts}:end={te},asetpts=PTS-STARTPTS[a{i}];")
        else:
            filter_parts.append(f"[{next_silence}:a]asetpts=PTS-STARTPTS[a{i}];")
            next_silence += 1

    concat_inputs = "".join([f"[v{i}][a{i}]" for i in range(n)])
    full_filter = "".join(filter_parts) + f"{concat_inputs}concat=n={n}:v=1:a=1[outv][outa]"
    command = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", full_filter,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        output_path
    ]
    subprocess.run(command, check=True)
    return output_filename


def generate_video_thumbnail(filename: str) -> None:
    """
    Generate a thumbnail image for a video file. Saves as {filename}.jpg in FILES_DIR.
    Uses first second of video so each clip gets its own frame.
    """
    video_path = os.path.join(FILES_DIR, filename)
    if not os.path.isfile(video_path):
        return
    image_filename = f"{filename}.jpg"
    image_path = os.path.join(FILES_DIR, image_filename)
    cmd = [
        "ffmpeg", "-y",
        "-ss", "00:00:00.5",
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        image_path
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=15)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        pass


async def render_split_timeline(request: SplitTimelineRequest):
    print(f"Rendering split timeline.")
    
    if not request.top_clips and not request.bottom_clips:
         raise ValueError("No clips provided for either timeline")
         
    num_files = len([n for n in os.listdir(FILES_DIR) if n.startswith("version") and n.endswith(".mp4")])
    output_filename = f"version{num_files+1}.mp4"
    # Ensure FILES_DIR exists (it should, but safety first)
    if not os.path.exists(FILES_DIR):
        os.makedirs(FILES_DIR)

    output_path = os.path.join(FILES_DIR, output_filename)

    temp_top = os.path.join(FILES_DIR, f"temp_top_{num_files+1}.mp4")
    temp_bottom = os.path.join(FILES_DIR, f"temp_bottom_{num_files+1}.mp4")
    
    def process_track(clips, output_temp):
        if not clips:
            # Create black filler
            subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=1920x1080:d=5", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", output_temp], check=True)
            return

        inputs = []
        filter_parts = []
        for i, clip in enumerate(clips):
             filename = clip.filename
             if filename.startswith("version") and not filename.endswith(".mp4"): filename += ".mp4"
             inputs.extend(["-i", os.path.join(FILES_DIR, filename)])
             
             filter_parts.append(f"[{i}:v]trim=start={clip.start}:end={clip.end},setpts=PTS-STARTPTS,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[v{i}];")
             filter_parts.append(f"[{i}:a]atrim=start={clip.start}:end={clip.end},asetpts=PTS-STARTPTS[a{i}];")
        
        concat_inputs = "".join([f"[v{i}][a{i}]" for i in range(len(clips))])
        final_filter = "".join(filter_parts) + f"{concat_inputs}concat=n={len(clips)}:v=1:a=1[v][a]"
        
        cmd = ["ffmpeg", "-y"] + inputs + ["-filter_complex", final_filter, "-map", "[v]", "-map", "[a]", output_temp]
        subprocess.run(cmd, check=True)

    # 1. Process Top
    process_track(request.top_clips, temp_top)
    
    # 2. Process Bottom
    process_track(request.bottom_clips, temp_bottom)

    # 3. Process Audio (BGM)
    temp_audio = None
    if request.audio_clips:
        temp_audio = os.path.join(FILES_DIR, f"temp_audio_{num_files+1}.mp3")
        
        inputs = []
        filter_parts = []
        for i, clip in enumerate(request.audio_clips):
             filename = clip.filename
             inputs.extend(["-i", os.path.join(FILES_DIR, filename)])
             filter_parts.append(f"[{i}:a]atrim=start={clip.start}:end={clip.end},asetpts=PTS-STARTPTS[a{i}];")
        
        concat_inputs = "".join([f"[a{i}]" for i in range(len(request.audio_clips))])
        final_filter = "".join(filter_parts) + f"{concat_inputs}concat=n={len(request.audio_clips)}:v=0:a=1[outa]"
        
        cmd = ["ffmpeg", "-y"] + inputs + ["-filter_complex", final_filter, "-map", "[outa]", temp_audio]
        subprocess.run(cmd, check=True)

    # 4. Stack
    # Calculate durations to handle looping
    dur_top = sum([c.end - c.start for c in request.top_clips])
    dur_bottom = sum([c.end - c.start for c in request.bottom_clips])
    if not request.top_clips: dur_top = 5
    if not request.bottom_clips: dur_bottom = 5
    
    max_dur = max(dur_top, dur_bottom)
    
    inputs = []
    
    # Input 0: Top
    if dur_top < max_dur:
        inputs.extend(["-stream_loop", "-1", "-i", temp_top])
    else:
        inputs.extend(["-i", temp_top])
        
    # Input 1: Bottom
    if dur_bottom < max_dur:
        inputs.extend(["-stream_loop", "-1", "-i", temp_bottom])
    else:
        inputs.extend(["-i", temp_bottom])
    
    # Calculate crop/pad for top
    def get_filter(idx, zoom, pan_y, label):
        offset = f"(960*({pan_y}/100))"
        chain = f"[{idx}:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,scale=iw*{zoom}:-1[z{label}];"
        
        if zoom >= 1:
            chain += f"[z{label}]crop=1080:960:(iw-1080)/2:(ih-960)/2-({offset})[{label}];"
        else:
            chain += f"[z{label}]pad=1080:960:(1080-iw)/2:(960-ih)/2+({offset}):black[{label}];"
        return chain

    top_filter = get_filter(0, request.top_zoom, request.top_pan_y, "topv")
    bot_filter = get_filter(1, request.bottom_zoom, request.bottom_pan_y, "botv")

    complex_filter = [
        top_filter,
        bot_filter,
        "[topv][botv]vstack=inputs=2[v];"
    ]
    
    # Add BGM mixing if exists
    if temp_audio:
        # Mix audio: [0:a] is top audio, [1:a] is bottom audio, [2:a] is bgm
        # We need to respect looping? 
        # Actually stream_loop applies to input. So [0:a] and [1:a] are already looped.
        # We just need to mix them.
        inputs.append("-i")
        inputs.append(temp_audio)
        
        # amix inputs=3
        # But maybe we want specific volumes?
        # Simple amix for now
        complex_filter.append(f"[0:a][1:a][2:a]amix=inputs=3:duration=longest[a]")
    else:
        complex_filter.append(f"[0:a][1:a]amix=inputs=2:duration=longest[a]")

    full_filter = "".join(complex_filter)
    
    command = [
        "ffmpeg", "-y",
    ] + inputs + [
        "-filter_complex", full_filter,
        "-map", "[v]", 
        "-map", "[a]",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(max_dur),
        output_path
    ]
    
    print(f"Executing: {command}")
    subprocess.run(command, check=True)
    
    # Cleanup temps
    try:
        if os.path.exists(temp_top): os.remove(temp_top)
        if os.path.exists(temp_bottom): os.remove(temp_bottom)
        if temp_audio and os.path.exists(temp_audio): os.remove(temp_audio)
    except Exception as e:
        print(f"Warning: Failed to clean up temp files: {e}")
