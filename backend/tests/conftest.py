"""Pytest fixtures. Creates a temp directory and a minimal video fixture for export tests."""
import os
import subprocess
import pytest


@pytest.fixture(scope="module")
def files_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("files")
    return str(d)


@pytest.fixture(scope="module")
def fixture_video(files_dir):
    """Create a 1-second minimal MP4 in files_dir."""
    path = os.path.join(files_dir, "fixture.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=320x240:d=1",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", "1",
            "-c:v", "libx264", "-c:a", "aac",
            path
        ],
        check=True,
        capture_output=True,
        timeout=10,
    )
    assert os.path.isfile(path)
    return path
