
from fastapi import FastAPI, File, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types
import shutil
from dotenv import load_dotenv
import os
from pydantic import BaseModel
from typing import Tuple, Union
import subprocess
from constants import SYSTEM_PROMPT, AUDIO_DESCRIPTION_SYSPROMPT
import time
import uuid
import base64
import asyncio
import edge_tts
import re
import json
import math
from concurrent.futures import ThreadPoolExecutor
import auto_generator # [NEW] Import for auto generator


app = FastAPI()
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from video_processor import FILES_DIR, ClipData, SplitTimelineRequest, render_split_timeline as render_split_timeline_logic
# UPLOAD_DIR =          # shreesh
# UPLOAD_DIR = r"D:\SWAGAT\idkhack\files\upload"         # swagat
# EDIT_DIR = r"D:\SWAGAT\idkhack\files\edit"             # swagat

# Mount the files directory to serve static files
app.mount("/files", StaticFiles(directory=FILES_DIR), name="files")


def audio_description(file: str, output_file: str):
    """
    file: Name of the file to be worked on (example: video.mp4)
    output_file: Name of the output file (example: audio.mp3)
    """
    print(file, output_file)
    file_ = client.files.upload(file=os.path.join(FILES_DIR, file))
    while file_.state.name == "PROCESSING":
        print("Waiting for the video to be processed")
        time.sleep(10)
        file_ = client.files.get(name=file_.name)

    if file_.state.name == "FAILED":
        raise ValueError(file_.state.name)
    print(f"video processing complete: {file_.uri}")

    chat = client.chats.create(
        model="gemini-2.5-flash-lite",
        config=types.GenerateContentConfig(system_instruction=AUDIO_DESCRIPTION_SYSPROMPT)
    )

    response = chat.send_message(message=types.Content(
        role="user",
        parts=[
            types.Part.from_uri(
                file_uri=file_.uri,
                mime_type=file_.mime_type,
            ),
            types.Part.from_text(text="Do audio description on this. remember to return with proper timestamps formatted within 3 backticks (```)"),
        ],
    ))

    print("audio description srt generated")
    srt = response.text.split("```")[1]
    cleaned_text = re.sub(r"\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n", "", srt)
    print(cleaned_text)

    communicate = edge_tts.Communicate(cleaned_text.strip(), "en-US-AriaNeural")
    print(communicate)

    # Run inside existing event loop safely
    loop = asyncio.get_event_loop()
    if loop.is_running():
        asyncio.ensure_future(communicate.save(os.path.join(FILES_DIR, output_file)))
    else:
        asyncio.run(communicate.save(os.path.join(FILES_DIR, output_file)))

    print(f"Audio saved to {output_file}")



def generate_snapshot(filename: str):
    """
    Generates a thumbnail snapshot for the given video file.
    Saves it as {filename}.jpg in the same directory.
    """
    print(f"Generating snapshot for {filename}")
    video_path = os.path.join(FILES_DIR, filename)
    image_filename = f"{filename}.jpg"
    image_path = os.path.join(FILES_DIR, image_filename)
    
    # Capture frame at 1 second mark
    command = [
        "ffmpeg", "-y",
        "-ss", "00:00:01",
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "2",
        image_path
    ]
    
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print(f"Snapshot generated: {image_filename}")
    except subprocess.CalledProcessError as e:
        print(f"Snapshot generation failed: {e.stderr}")

# os.makedirs(UPLOAD_DIR, exist_ok=True)
def ffmpeg_runner(ffmpeg_code: str):
    print(ffmpeg_code)
    try:
        process = subprocess.run(
            ffmpeg_code, 
            shell=True, 
            check=True, 
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, 
            text=True
        )
        print(process.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg failed with error:\n{e.output}")
        return False

def scene_detect_runner(scene_detect_code: str):
    print(scene_detect_code)
    try:
        process = subprocess.run(
            scene_detect_code, 
            shell=True, 
            check=True, 
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, 
            text=True
        )
        print(process.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Scene detection failed with error:\n{e.output}")
        return False

def whisper_runner(whisper_code: str):
    print(whisper_code)
    try:
        process = subprocess.run(
            whisper_code, 
            shell=True, 
            check=True, 
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, 
            text=True
        )
        print(process.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Whisper failed with error:\n{e.output}")
        return False

import json

def read_transcript(video_filename: str):
    """
    Reads the sidecar JSON transcript file for a given video.
    Returns the list of word segments with timestamps.
    """
    # Fix filename if it doesn't end with .mp4 but prompt uses it that way
    if not video_filename.endswith(".mp4"):
        video_filename += ".mp4"
        
    print(f"Reading transcript for {video_filename}")
    # The JSON file should have the same basename
    json_filename = os.path.splitext(video_filename)[0] + ".json"
    json_path = os.path.join(FILES_DIR, json_filename)
    
    if not os.path.exists(json_path):
        return f"Error: No transcript found for {video_filename}. Please ensure the video was uploaded correctly."
        
    try:
        with open(json_path, "r") as f:
            data = json.load(f)
        
        # Whisper output format validation
        # Usually data['segments'] contains 'words' if word_timestamps=True
        # Flattening to just words for easier LLM consumption
        words = []
        if 'segments' in data:
            for segment in data['segments']:
                if 'words' in segment:
                    for word in segment['words']:
                        words.append({
                            "word": word['word'],
                            "start": word['start'],
                            "end": word['end']
                        })
                else:
                    # Fallback if no word level timestamps
                    words.append({
                        "text": segment['text'],
                        "start": segment['start'],
                        "end": segment['end']
                    })
        else:
            # Fallback for unexpected structure
            return f"Error: Unexpected transcript format."

        # Round timestamps to 2 decimal places for cleaner output
        for item in words:
            if 'start' in item:
                item['start'] = round(item['start'], 2)
            if 'end' in item:
                item['end'] = round(item['end'], 2)
            
        return json.dumps(words)
    except Exception as e:
        print(f"Failed to read transcript: {e}")
        return f"Error reading transcript: {str(e)}"

def edit_video_intervals(video_filename: str, intervals: list[dict[str, float]]):
    """
    Cuts the video to keep ONLY the specified intervals.
    intervals: list of dicts [{'start': 0.0, 'end': 10.0}, ...]
    Saves as the next version number.
    """
    print(f"Editing intervals for {video_filename}: {intervals}")
    
    if not video_filename.endswith(".mp4"):
        video_filename += ".mp4"
        
    input_path = os.path.join(FILES_DIR, video_filename)
    if not os.path.exists(input_path):
        return f"Error: Input file {video_filename} not found."
        
    if not intervals:
        return "Error: No intervals provided."
        
    # Calculate next version number
    num_files = 0
    for name in os.listdir(FILES_DIR):
        if os.path.isfile(os.path.join(FILES_DIR, name)) and name.startswith("version") and name[7:-4].isdigit():
            num_files += 1
    
    output_filename = f"version{num_files+1}.mp4"
    output_path = os.path.join(FILES_DIR, output_filename)
    
    # Build complex filter
    filter_parts = []
    concat_inputs = []
    
    for i, interval in enumerate(intervals):
        start = interval.get('start')
        end = interval.get('end')
        
        # Validation
        if start is None or end is None:
            continue
            
        # Segment filter
        # [0:v]trim=start=S:end=E,setpts=PTS-STARTPTS[vI];[0:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[aI]
        segment_v = f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}]"
        segment_a = f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
        
        filter_parts.append(segment_v)
        filter_parts.append(segment_a)
        concat_inputs.append(f"[v{i}][a{i}]")
        
    # Concat part
    concat_filter = f"{''.join(concat_inputs)}concat=n={len(intervals)}:v=1:a=1[outv][outa]"
    full_filter = ";".join(filter_parts) + ";" + concat_filter
    
    command = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", full_filter,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        output_path
    ]
    
    # Convert command list to string for logging/debugging consistency with existing code style if needed, 
    # but subprocess requires list for safety generally or string for shell=True. 
    # The existing codebase mixes them. I'll use list and no shell=True for safety with complex filters.
    
    print(f"Running ffmpeg command for intervals...")
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(f"Created {output_filename}")
        return output_filename
    except subprocess.CalledProcessError as e:
        print(f"FFmpeg interval edit failed: {e.output}")
        return f"Error running ffmpeg: {e.output}"

def analyze_transcript_in_chunks(video_filename: str, criteria: str, chunk_duration: int):
    """
    Analyzes a long transcript in chunks to find intervals to KEEP based on criteria.
    Use this for tasks like "remove fillers" on videos longer than 2 minutes.
    Returns a unified list of intervals: [{'start': 0, 'end': 10}, ...]
    """
    print(f"Analyzing {video_filename} in chunks of {chunk_duration}s with criteria: {criteria}")
    
    # 1. Get transcript
    transcript_json = read_transcript(video_filename)
    if transform_error := is_error(transcript_json): 
         return transform_error
         
    try:
        words = json.loads(transcript_json)
    except json.JSONDecodeError:
        return "Error: Invalid transcript JSON."

    if not words:
        return "Error: Empty transcript."
        
    # 2. Split into chunks by time
    try:
        video_end = words[-1].get('end', 0)
    except Exception:
        video_end = 0

    if video_end == 0:
         # Fallback if end time missing, just use list length approx
         num_chunks = max(1, math.ceil(len(words) / 200)) # Approx 200 words per min??
         # Better to just iterate
         pass

    # Better grouping logic:
    chunks = []
    current_chunk = []
    current_chunk_index = 0
    
    for word in words:
        if 'start' not in word:
            continue
        
        chunk_idx = int(word['start'] // chunk_duration)
        
        # If we jumped to a new chunk
        while len(chunks) <= chunk_idx:
            chunks.append([])
            
        chunks[chunk_idx].append(word)
            
    # 3. Analyze each chunk
    all_keep_intervals = []
    
    # Helper to process one chunk (can be parallelized later if needed)
    def process_chunk(index, chunk_words):
        if not chunk_words:
            return []
            
        start_time = index * chunk_duration
        end_time = (index + 1) * chunk_duration
        
        # simplified transcript for this chunk
        chunk_text = " ".join([w['word'] for w in chunk_words if 'word' in w])
        
        chunk_prompt = f"""
        Analyze this transcript segment (from {start_time}s to {end_time}s).
        Goal: {criteria}
        
        Return a valid JSON list of time intervals inside this segment that should be KEPT.
        Format: [{{"start": 10.5, "end": 15.2}}, ...]
        
        Rules:
        - Only include time ranges present in the inputs.
        - Merge adjacent valid speech.
        - Return ONLY the JSON list, no markdown or text.
        
        Transcript with timestamps:
        {json.dumps(chunk_words)}
        """
        
        try:
            # We use a synchronous call here since this is inside a tool
            # Assuming 'client' is available in global scope or we create a new one
            # Ideally we reuse the global client but use the sync method
            response = client.models.generate_content(
                model="gemini-2.5-flash-lite", # Use consistent model
                contents=chunk_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            
            result = json.loads(response.text)
            return result if isinstance(result, list) else []
        except Exception as e:
            print(f"Error processing chunk {index}: {e}")
            return []

    # Process all chunks
    # Simple serial processing for reliability first
    for i, chunk in enumerate(chunks):
        if chunk:
            intervals = process_chunk(i, chunk)
            all_keep_intervals.extend(intervals)
        
    print(f"Batch analysis complete. Found {len(all_keep_intervals)} intervals.")
    return all_keep_intervals

def is_error(s):
    if isinstance(s, str) and s.startswith("Error"):
        return s
    return None

from fastapi import BackgroundTasks

@app.get("/media")
async def list_media():
    """List all available media files in the files directory."""
    files = []
    if os.path.exists(FILES_DIR):
        for filename in os.listdir(FILES_DIR):
            if filename.startswith("normalized_"):
                # We show the original name (part after normalized_) but allow accessing via normalized path if needed
                # Actually, our upload logic renames normalized_X to X at the end.
                # So we just look for files.
                pass
            
            filepath = os.path.join(FILES_DIR, filename)
            if os.path.isfile(filepath) and not filename.startswith("."):
                # Basic filter for media types
                if filename.lower().endswith(('.mp4', '.mp3', '.wav', '.mkv', '.mov')):
                    # Determine type
                    media_type = "video" if filename.lower().endswith(('.mp4', '.mkv', '.mov')) else "audio"
                    
                    files.append({
                        "id": filename, # Use filename as ID for simplicity on existing files
                        "filename": filename,
                        "url": f"http://127.0.0.1:8000/files/{filename}",
                        "type": media_type,
                        "type": media_type,
                        "uploadDate": os.path.getmtime(filepath),
                        "thumbnailUrl": f"http://127.0.0.1:8000/files/{filename}.jpg" if os.path.exists(os.path.join(FILES_DIR, f"{filename}.jpg")) else None
                    })
    
    # Sort by date desc
    files.sort(key=lambda x: x['uploadDate'], reverse=True)
    return files

async def process_transcription(file_path: str):
    print(f"Starting transcription for {file_path}")
    output_dir = os.path.dirname(file_path)
    
    # Run Whisper
    # We use --model base to be faster, but user can change to medium/large if needed for accuracy
    # --output_format json is critical for processing
    # --word_timestamps True is critical for future cue-based editing
    command = f'whisper "{file_path}" --model base --output_dir "{output_dir}" --output_format json --word_timestamps True'
    
    try:
        process = subprocess.run(
            command,
            shell=True,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        print(f"Transcription completed for {file_path}")
        print(process.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Transcription failed for {file_path}: {e.output}")

@app.post("/upload")
async def upload_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    print(f"Uploading file: {file.filename}")
    if not file.filename:
        raise ValueError("No filename provided")
    
    # Ensure FILES_DIR exists
    if not os.path.exists(FILES_DIR):
        try:
            os.makedirs(FILES_DIR)
        except OSError as e:
            print(f"Error creating files directory: {e}")
            raise ValueError(f"Server configuration error: Could not create upload directory.")

    file_path = os.path.join(FILES_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except IOError as e:
        print(f"Error saving uploaded file: {e}")
        raise ValueError(f"Failed to save uploaded file: {e}")

    final_filename = file.filename
    # We will invoke ffmpeg to normalize the file.
    # Using list arguments for subprocess to avoid shell injection and quoting issues.
    
    if file.filename.endswith(".mp4"):
        try:
            input_path = os.path.join(FILES_DIR, file.filename)
            output_path = os.path.join(FILES_DIR, f"normalized_{file.filename}")
            
            # Use list format for command
            command = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1,setsar=1",
                "-r", "30",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
                "-movflags", "+faststart",
                output_path
            ]
            
            print(f"Running normalization: {command}")
            result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # If successful, swap files
            os.remove(input_path)
            os.rename(output_path, input_path)
            
        except subprocess.CalledProcessError as e:
            print(f"MP4 Normalization failed. Return code: {e.returncode}")
            print(f"STDOUT: {e.stdout}")
            print(f"STDERR: {e.stderr}")
            # Identify common errors
            if "Permission denied" in e.stderr:
                 raise ValueError("Server permission error during video processing.")
            raise ValueError(f"Video processing failed: {e.stderr[:200]}...") # Return partial error to user
            
    elif file.filename.endswith(".mp3"):
        try:
            input_path = os.path.join(FILES_DIR, file.filename)
            output_path = os.path.join(FILES_DIR, f"normalized_{file.filename}")
            
            command = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-b:a", "192k", "-ar", "44100",
                output_path
            ]
            
            print(f"Running normalization: {command}")
            result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            
            os.remove(input_path)
            os.rename(output_path, input_path)
            
        except subprocess.CalledProcessError as e:
            print(f"MP3 Normalization failed: {e.stderr}")
            raise ValueError(f"Audio processing failed: {e.stderr[:200]}...")

    # Trigger background transcription and snapshot generation
    final_path = os.path.join(FILES_DIR, final_filename)
    background_tasks.add_task(process_transcription, final_path)
    background_tasks.add_task(generate_snapshot, final_filename)

    return {"filename": final_filename, "message": "File uploaded successfully"}

class Query(BaseModel):
    prompt: str
    video_version: str

@app.post("/query")
async def user_query(query: Query) -> Tuple[bool, Union[int, str]]:
    """
    work on the mentioned video version using the given prompt.

    example: trim this video from 2nd second to the 7th second.

    It'll then use this prompt on the specified video with the name "video_version.mp4".

    Returns:
        Tuple[bool, Union[int, str]]: (success, version_number_or_error_message)
    """

    # edit_dir = r"C:\Users\Robin Roy\Desktop\idkhack\files\edit"
    # edit_dir = r"C:\Users\Robin Roy\Desktop\idkhack\files\edit"           # SHREESH
    # edit_dir = r"D:\SWAGAT\idkhack\files\edit"           # SWAGAT
    query.prompt = query.prompt.replace("@", "")
    print(query)
    num_files = 0
    for name in os.listdir(FILES_DIR):
        if os.path.isfile(os.path.join(FILES_DIR, name)) and name.startswith("version") and name[7:-4].isdigit():
            num_files += 1
    print(num_files)

# For some queries, you'll need to work on the latest edit, so you've to work on the current file: ../files/edit/{query.video_version}. Save the new file as {num_files+1}

    chat = client.aio.chats.create(
        model="gemini-2.5-flash-lite",
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT.format(num_files+1, num_files+1, num_files+1, query.video_version),
            tools=[ffmpeg_runner, scene_detect_runner, whisper_runner, audio_description, read_transcript, edit_video_intervals, analyze_transcript_in_chunks],
            temperature=0,
        ),
    )

    prompt_suffix = f" - You are editing '{query.video_version}'. The new output file must be named 'version{num_files+1}.mp4'."
    response = await chat.send_message(query.prompt + prompt_suffix)
    print(response)

    try:
        # Check if the expected output file was actually created
        expected_output = f"version{num_files+1}.mp4"
        if os.path.exists(os.path.join(FILES_DIR, expected_output)):
            return True, num_files+1
        else:
            # If the model returned a text response explaining why it couldn't do it, use that.
            error_msg = "The model could not process your request."
            if response.candidates and response.candidates[0].content.parts:
                part = response.candidates[0].content.parts[0]
                if part.text:
                    error_msg = part.text
            
            print(f"Error: Expected output file {expected_output} was not created. Model said: {error_msg}")
            return False, error_msg
            
    except Exception as e:
        print(e)
        return False, str(e)

class ClipData(BaseModel):
    filename: str
    start: float = 0.0
    end: float = 10.0

class TimelineRequest(BaseModel):
    clips: list[ClipData]

class ThumbnailRequest(BaseModel):
    prompt: str
    filename: str = None  # Optional: filename of the source video/snapshot

@app.post("/generate_thumbnail")
async def generate_thumbnail(request: ThumbnailRequest):
    try:
        print(f"Generating thumbnail for prompt: {request.prompt}")
        
        # Call Google Gemini 2.5 Flash Image (Nano Banana) using generate_content
        response = client.models.generate_content(
            model='gemini-2.5-flash-image',
            contents=[request.prompt]
        )

        image_bytes = None
        for part in response.parts:
            if part.inline_data is not None:
                # part.inline_data.data is already bytes in the SDK, or might need decoding depending on version
                # The user snippet uses part.as_image() but we need raw bytes for saving or base64.
                # Let's handle it safely.
                # If using the latest SDK, inline_data.data should be the bytes.
                image_bytes = part.inline_data.data
                break
        
        if not image_bytes:
             raise ValueError("No image part found in response")

        # Save to files directory
        output_filename = f"thumbnail_{uuid.uuid4()}.png"
        output_path = os.path.join(FILES_DIR, output_filename)
        
        with open(output_path, "wb") as f:
            f.write(image_bytes)
            
        return {
            "url": f"http://127.0.0.1:8001/files/{output_filename}",
            "filename": output_filename
        }

    except Exception as e:
        print(f"Thumbnail generation failed: {e}")
        # Fallback to a mock response or error if strictly needed, 
        # but frontend handles error by using snapshot.
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/render_timeline")
async def render_timeline(request: TimelineRequest):
    print(f"Rendering timeline with clips: {request.clips}")
    
    if not request.clips:
        raise ValueError("No clips provided")
        
    num_files = len([n for n in os.listdir(FILES_DIR) if n.startswith("version") and n.endswith(".mp4")])
    output_filename = f"version{num_files+1}.mp4"
    output_path = os.path.join(FILES_DIR, output_filename)
    
    inputs = []
    filter_complex_parts = []
    
    for i, clip in enumerate(request.clips):
        filename = clip.filename
        if filename.startswith("version") and not filename.endswith(".mp4"):
            filename += ".mp4"
        
        clip_path = os.path.join(FILES_DIR, filename)
        inputs.extend(["-i", clip_path])
        
        # Apply trim and scale to vertical 1080x1920 (TikTok size)
        filter_complex_parts.append(f"[{i}:v]trim=start={clip.start}:end={clip.end},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v{i}];")
        filter_complex_parts.append(f"[{i}:a]atrim=start={clip.start}:end={clip.end},asetpts=PTS-STARTPTS[a{i}];")
        
    # Concat part
    concat_inputs = "".join([f"[v{i}][a{i}]" for i in range(len(request.clips))])
    concat_filter = f"{concat_inputs}concat=n={len(request.clips)}:v=1:a=1[outv][outa]"
    
    full_filter = "".join(filter_complex_parts) + concat_filter
    
    command = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", full_filter,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        output_path
    ]
    
    print(f"Executing: {command}")
    subprocess.run(command, check=True)
    
    return {"filename": output_filename, "message": "Timeline rendered successfully"}

class SplitTimelineRequest(BaseModel):
    top_clips: list[ClipData]
    bottom_clips: list[ClipData]
    audio_clips: list[ClipData] = []
    top_zoom: float = 1.0
    top_pan_y: float = 0.0
    bottom_zoom: float = 1.0
    bottom_pan_y: float = 0.0

@app.post("/render_split_timeline")
async def render_split_timeline(request: SplitTimelineRequest):
    print(f"Rendering split timeline.")
    
    if not request.top_clips and not request.bottom_clips:
         raise ValueError("No clips provided for either timeline")
         
    num_files = len([n for n in os.listdir(FILES_DIR) if n.startswith("version") and n.endswith(".mp4")])
    output_filename = f"version{num_files+1}.mp4"
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
        # Reuse process_track but we only care about audio. However process_track does [v][a].
        # We can just extract [a] from it or write a simpler audio processor.
        # Simpler: just concat the audio clips.
        # But process_track handles trimming. Let's use it but ignore video in final mix?
        # Actually process_track generates a video file with black video if input is audio? 
        # ffmpeg -i audio.mp3 -> it has no video stream. process_track expects video stream for [v{i}].
        # We need a separate audio processor.
        
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
    # Base slot size: 1080x960.
    # Logic:
    # 1. Scale input to 1080x960 (force cover) -> [base]
    # 2. Scale [base] by zoom -> [zoomed]
    # 3. Crop/Pad [zoomed] to 1080x960
    
    def get_filter(idx, zoom, pan_y, label):
        # pan_y is percent (-50 to 50). Positive means move visual DOWN.
        # Offset in pixels = 960 * (pan_y / 100)
        # If visual moves down, crop window moves UP (y decreases).
        # So we subtract offset.
        offset = f"(960*({pan_y}/100))"
        
        chain = f"[{idx}:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,scale=iw*{zoom}:-1[z{label}];"
        
        if zoom >= 1:
            # Crop
            # x = (iw-1080)/2
            # y = (ih-960)/2 - offset
            chain += f"[z{label}]crop=1080:960:(iw-1080)/2:(ih-960)/2-({offset})[{label}];"
        else:
            # Pad
            # x = (1080-iw)/2
            # y = (960-ih)/2 + offset (Pad adds space, wait. If image is small, padding centers it.)
            # If we want to move small image DOWN, we increase top padding?
            # pad args: w:h:x:y:color
            # x,y are offsets of input inside padded area.
            # Default (1080-iw)/2 centers it.
            # If we want visual DOWN, we ADD to y.
            # So y = (960-ih)/2 + offset
            chain += f"[z{label}]pad=1080:960:(1080-iw)/2:(960-ih)/2+({offset}):black[{label}];"
        return chain

    top_filter = get_filter(0, request.top_zoom, request.top_pan_y, "topv")
    bot_filter = get_filter(1, request.bottom_zoom, request.bottom_pan_y, "botv")

    complex_filter = [
        top_filter,
        bot_filter,
        "[topv][botv]vstack=inputs=2[v];"
    ]
    
    # Render command

    if temp_audio:
        inputs.extend(["-i", temp_audio])
        # Mix 3 inputs: Top Audio [0:a], Bottom Audio [1:a], BGM [2:a]
        complex_filter.append("[0:a][1:a][2:a]amix=inputs=3[a]")
    else:
        # Mix 2 inputs
        complex_filter.append("[0:a][1:a]amix=inputs=2[a]")

    stack_cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", "".join(complex_filter),
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(max_dur),
        output_path
    ]
    
    print(f"Stacking: {stack_cmd}")
    subprocess.run(stack_cmd, check=True)
    
    # Cleanup
    if os.path.exists(temp_top): os.remove(temp_top)
    if os.path.exists(temp_bottom): os.remove(temp_bottom)
    if temp_audio and os.path.exists(temp_audio): os.remove(temp_audio)
    
    return {"filename": output_filename, "message": "Split timeline rendered successfully"}

@app.delete("/delete/{filename}")
async def delete_file(filename: str):
    """Delete a file from the filesystem."""
    try:
        if filename.startswith("version") and not filename.endswith(".mp4"):
            filename += ".mp4"
            
        file_path = os.path.join(FILES_DIR, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            
            # Also clean up any associated json transcript
            json_path = os.path.splitext(file_path)[0] + ".json"
            if os.path.exists(json_path):
                os.remove(json_path)
                
            return {"message": f"Deleted {filename}"}
        else:
            return {"message": "File not found"} 
            
    except Exception as e:
        print(f"Error deleting file {filename}: {e}")
        raise ValueError(f"Failed to delete file: {e}")

# --- NEW ENDPOINT FOR AUTO GENERATION ---

class AutoGenRequest(BaseModel):
    filename: str

@app.post("/auto_generate")
async def auto_generate_endpoint(request: AutoGenRequest, background_tasks: BackgroundTasks):
    print(f"Received auto-generate request for {request.filename}")
    
    # We can run this in background
    # background_tasks.add_task(auto_generator.generate_viral_clips, request.filename)
    # But user might want immediate feedback or at least status.
    # Let's run it and return the result for now (it takes time though).
    
    # Better: Run it and return.
    result = await auto_generator.generate_viral_clips(request.filename)
    return result