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


def call_gemini_api(transcript):
    logging.info("STARTING call_gemini_api")

    prompt = dedent(f"""
        You will be given a complete transcript from a video. Your task is to identify three 1-minute long clips from this video that have the highest potential to become popular on social media. 
        
        Follow these steps to complete the task:
        
        1. Carefully read through the entire transcript, looking for the most powerful, emotionally impactful, surprising, thought-provoking, or otherwise memorable moments. Give priority to answers and speculations rather than questions.
        
        2. For each standout moment you identify, extract a 1-minute segment of text from the transcript, centered around that moment. Ensure each segment is approximately 1 minute long when spoken (about 125 words or 10 spoken sentences).
        
        3. From these segments, choose the top three that you believe have the highest potential to go viral on social media.
        
        4. Rank these three clips from most to least viral potential based on your assessment.
        
        5. Determine the word count for each of the selected clips.
        
        here is the transcript:
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
            # Ensure there are exactly three clips
            if len(response_data.get('clips', [])) != 3:
                logging.warning("The response does not contain exactly three clips. Adjusting...")
                # Basic adjustment if needed, but Gemini usually respects schema
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