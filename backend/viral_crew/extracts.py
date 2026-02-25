import sys
import json
import os
from textwrap import dedent
import logging
from pathlib import Path
import traceback

# Third party imports
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Local application imports

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("API key not found. Please set the GEMINI_API_KEY environment variable.")

client = genai.Client(api_key=api_key)


def get_whisper_output():
    whisper_output_dir = Path('whisper_output')
    if not whisper_output_dir.exists():
        logging.error(f"Directory not found: {whisper_output_dir}")
        return None, None

    srt_files = list(whisper_output_dir.glob('*.srt'))
    txt_files = list(whisper_output_dir.glob('*.txt'))

    if not srt_files or not txt_files:
        logging.warning("No .srt or .txt files found in the whisper_output directory.")
        return None, None

    with open(txt_files[0], 'r') as file:
        transcript = file.read()

    with open(srt_files[0], 'r') as file:
        subtitles = file.read()

    return transcript, subtitles


def call_gemini_api(transcript, duration_seconds=None, concept=None):
    """
    Ask Gemini for viral clip suggestions. If duration_seconds is set, request 5-15 clips per hour
    (min 3, max 15), ranked by predicted virality. If concept is provided, prioritize clips that
    best match the user's description/intent.
    """
    logging.info("STARTING call_gemini_api")
    if duration_seconds is not None and duration_seconds > 0:
        num_clips = max(3, min(15, int(round(duration_seconds / 3600 * 10))))
    else:
        num_clips = 3

    concept_block = ""
    if concept and concept.strip():
        concept_block = dedent(f"""
        The user's intended focus or concept for the final video:
        <user_concept>
        {concept.strip()}
        </user_concept>
        Prioritize clips that best support or align with this concept—e.g. if it's a travel vlog, favor scenic or narrative moments; if it's a tutorial, favor clear explanations. Still rank by viral potential within that focus.
        """)

    prompt = dedent(f"""
        You will be given a complete transcript from a video. Your task is to identify {num_clips} short clips from this video that have the highest potential to become popular on social media (e.g. TikTok). Rank them by predicted virality (most viral first).
        {concept_block}
        CRITICAL: Each clip must be between 10 and 20 seconds when spoken. Minimum 3 seconds, maximum 30 seconds. When spoken at normal pace, 10-20 seconds is roughly 25-50 words (about 2-4 short sentences) per clip.
        
        Follow these steps:
        
        1. Carefully read through the entire transcript, looking for the most powerful, emotionally impactful, surprising, thought-provoking, or memorable moments. Give priority to answers and speculations rather than questions. When a user concept is provided, favor moments that align with it.
        
        2. For each standout moment, extract a SHORT segment of text centered around that moment. Each segment must be 10-20 seconds when spoken (approximately 25-50 words). Do not use 1-minute or long segments.
        
        3. Choose the top {num_clips} such segments that have the highest viral potential (and best match the user concept when provided).
        
        4. Rank these {num_clips} clips from most to least viral potential (predicted virality score).
        
        5. Determine the word count for each selected clip (each should be roughly 25-50 words).
        
        Here is the transcript:
        <transcript>
        {transcript}
        </transcript>
    """)

    try:
        chat = client.chats.create(
            model="gemini-2.5-flash-lite",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema={
                    "type": "object",
                    "properties": {
                        "clips": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "rank": {"type": "integer"},
                                    "text": {"type": "string"},
                                    "wordcount": {"type": "integer"}
                                },
                                "required": ["rank", "text", "wordcount"]
                            }
                        }
                    },
                    "required": ["clips"]
                }
            )
        )
        
        response = chat.send_message(prompt)
        
        if not response.text:
            logging.error("No response from Gemini API")
            return None

        response_text = response.text
        logging.info(f"Raw API response: {response_text}")

        try:
            response_data = json.loads(response_text)
            clips = response_data.get('clips', [])
            if len(clips) < 1:
                logging.warning("Response has no clips.")
            return response_data
        except json.JSONDecodeError as e:
            logging.error(f"JSON Decode Error: {str(e)}")
            return None
            
    except Exception as e:
        logging.error(f"Error calling Gemini API: {str(e)}")
        logging.error(traceback.format_exc())
        return None


def save_response_to_file(response, output_path):
    try:
        with open(output_path, 'w') as f:
            json.dump(response, f, indent=4)
        logging.info(f"Response saved to {output_path}")
    except Exception as e:
        logging.error(f"Error saving response to file: {e}")


def main():
    logging.info('STARTING extracts.py (Gemini Version)')

    transcript, subtitles = get_whisper_output()
    if transcript is None or subtitles is None:
        logging.error("Failed to get whisper output")
        return None

    response = call_gemini_api(transcript)
    if response and 'clips' in response:
        output_dir = Path('crew_output')
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / 'api_response.json'
        save_response_to_file(response, output_path)

        # Extract the text from each clip to match crew.py's expectations
        extracts = [clip['text'] for clip in response['clips']]
        return extracts
    else:
        logging.error("Failed to get a valid response from Gemini API")
        return None


if __name__ == "__main__":
    main()