
import os
import subprocess
from pydantic import BaseModel
from typing import List, Optional

# Define global constants
FILES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "files")
if not os.path.exists(FILES_DIR):
    os.makedirs(FILES_DIR)

class ClipData(BaseModel):
    filename: str
    start: float = 0.0
    end: float = 10.0

class SplitTimelineRequest(BaseModel):
    top_clips: List[ClipData]
    bottom_clips: List[ClipData]
    audio_clips: List[ClipData] = []
    top_zoom: float = 1.0
    top_pan_y: float = 0.0
    bottom_zoom: float = 1.0
    bottom_pan_y: float = 0.0

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
