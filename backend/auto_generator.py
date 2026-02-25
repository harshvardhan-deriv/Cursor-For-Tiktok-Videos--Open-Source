
import os
import sys
import subprocess
import logging
import asyncio
from pathlib import Path

# Add viral_crew to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'viral_crew'))

# Import viral crew modules
# using dynamic imports or just standard imports if path is correct
from viral_crew import extracts, crew, local_transcribe

from video_processor import render_timeline_clips, ClipData, FILES_DIR, generate_video_thumbnail


def _get_duration_seconds(filepath: str):
    """Return video duration in seconds via ffprobe, or None."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filepath],
            capture_output=True, text=True, timeout=15
        )
        if out.returncode == 0 and out.stdout and out.stdout.strip():
            return float(out.stdout.strip())
    except (subprocess.TimeoutExpired, ValueError, OSError):
        pass
    return None

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def _srt_timestamp_to_seconds(timestamp: str) -> float:
    """Convert SRT timestamp 'HH:MM:SS,mmm' to seconds."""
    timestamp = timestamp.strip().replace(",", ".")
    parts = timestamp.split(":")
    if len(parts) != 3:
        return 0.0
    try:
        h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
        return h * 3600 + m * 60 + s
    except ValueError:
        return 0.0


def parse_srt_time_range(srt_path: str) -> tuple:
    """
    Read an SRT file and return (start_seconds, end_seconds) for the full segment.
    Uses the first cue's start and the last cue's end.
    """
    import re
    if not os.path.exists(srt_path):
        return 0.0, 10.0
    with open(srt_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    # Match lines like "00:01:57,000 --> 00:02:00,400"
    pattern = re.compile(r"(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})")
    matches = pattern.findall(content)
    if not matches:
        return 0.0, 10.0
    start_sec = _srt_timestamp_to_seconds(matches[0][0])
    end_sec = _srt_timestamp_to_seconds(matches[-1][1])
    if end_sec <= start_sec:
        end_sec = start_sec + 10.0
    # Clamp segment duration to 3–30 seconds (viral clips target 10–20 sec)
    duration = end_sec - start_sec
    if duration > 30:
        end_sec = start_sec + 30
    elif duration < 3:
        end_sec = start_sec + 3
    return start_sec, end_sec


async def generate_viral_clips(video_filename: str, concept: str | None = None):
    """
    Full pipeline (per README: Upload → Normalize → Transcribe → Analyze → Viral Segments → Render):
    1. Transcribe (Whisper)
    2. Identify viral segments (Gemini), optionally guided by user concept/description
    3. Get timestamps (Crew)
    4. Render each segment as a single vertical clip (one file per viral moment)
    """
    logging.info(f"Starting auto-generation for {video_filename}")
    
    # 1. Setup workspace (use backend CWD)
    # viral_crew reads from whisper_output (first .srt) and writes to crew_output
    whisper_dir = "whisper_output"
    crew_dir = "crew_output"
    os.makedirs(whisper_dir, exist_ok=True)
    os.makedirs(crew_dir, exist_ok=True)
    # Clear old outputs so this run's files are the only ones
    for d in (whisper_dir, crew_dir):
        for f in os.listdir(d):
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass

    video_path = os.path.join(FILES_DIR, video_filename)
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")
        
    # Copy video to a place where local_transcribe expects inputs? 
    # local_transcribe.local_whisper_process iterates over 'input_files' folder. 
    # Let's bypass that and call transcribe_main directly if possible, or adapt.
    # local_transcribe.transcribe_main(file) returns transcript, subtitles
    
    logging.info("Step 1: Transcribing...")
    # We can use the transcribe_main from local_transcribe
    # It uses a global model which loads on import or first call.
    try:
        transcript, subtitles = local_transcribe.transcribe_main(video_path)
    except Exception as e:
        logging.error(f"Transcription failed: {e}")
        return {"status": "error", "message": f"Transcription failed: {str(e)}"}

    logging.info("Step 2: Identifying Viral Clips...")
    duration_sec = _get_duration_seconds(video_path)
    viral_response = extracts.call_gemini_api(
        transcript, duration_seconds=duration_sec, concept=concept
    )
    if not viral_response or 'clips' not in viral_response:
        return {"status": "error", "message": "Failed to identify viral clips."}

    top_extracts = [clip['text'] for clip in viral_response['clips']]
    if len(top_extracts) < 1:
        return {"status": "error", "message": "No viral clips identified."}
    logging.info(f"Identified {len(top_extracts)} viral extracts (ranked by virality).")

    logging.info("Step 3: Getting Timestamps...")
    # crew.main(extracts) reads subtitles from 'whisper_output' folder.
    # It uses 'get_subtitles()' which reads the first *.srt file.
    # So we must ensure only our current file is there or we modify crew.py.
    # For MVP, let's rely on the file existence.
    
    # We need to mock the arg passing or call main.
    # crew.main(extracts) returns the result string, but it writes to crew_output/*.srt
    
    # NOTE: crew.py uses 'gemini-1.5-pro-exp-0801' which might be deprecated or gated. 
    # We should probably update crew.py model to 'gemini-1.5-pro' or 'gemini-2.0-flash'.
    # I'll check crew.py content later.
    
    try:
        crew_result = crew.main(top_extracts)
    except Exception as e:
        logging.error(f"Crew execution failed: {e}")
        return {"status": "error", "message": f"Timestamping failed: {str(e)}"}
        
    # Step 4: Render each viral segment as a single clip (vertical 9:16), not split-screen
    final_outputs = []
    crew_output_dir = "crew_output"
    srt_files = [f for f in os.listdir(crew_output_dir) if f.endswith(".srt")]
    srt_files.sort()

    logging.info(f"Found {len(srt_files)} generated subtitle files for rendering.")

    for i, srt_file in enumerate(srt_files):
        srt_path = os.path.join(crew_output_dir, srt_file)
        try:
            start_time, end_time = parse_srt_time_range(srt_path)
            logging.info(f"Clip {i+1}: {start_time:.1f}s - {end_time:.1f}s")
            # One clip per viral segment → one version file per segment (no split-screen)
            clip = ClipData(filename=video_filename, start=start_time, end=end_time)
            output_name = render_timeline_clips([clip])
            generate_video_thumbnail(output_name)
            final_outputs.append(output_name)
        except Exception as e:
            logging.error(f"Render failed for clip {i+1}: {e}")

    return {"status": "success", "outputs": final_outputs}
