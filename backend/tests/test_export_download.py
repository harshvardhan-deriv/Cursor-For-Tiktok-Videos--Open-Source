"""Test that render_timeline returns a downloadable file (FileResponse with Content-Disposition)."""
import os
import sys

import pytest
from fastapi.testclient import TestClient

# Run from backend directory so imports work
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


@pytest.fixture
def app_with_test_files(files_dir, fixture_video):
    """Patch FILES_DIR so render_timeline_clips writes to test temp dir."""
    import video_processor as vp_mod
    original = vp_mod.FILES_DIR
    vp_mod.FILES_DIR = files_dir
    try:
        from main import app
        yield app
    finally:
        vp_mod.FILES_DIR = original


def test_render_timeline_returns_attachment(app_with_test_files, files_dir, fixture_video):
    """POST /render_timeline with one clip returns 200 and Content-Disposition: attachment."""
    client = TestClient(app_with_test_files)
    payload = {
        "clips": [
            {"filename": "fixture.mp4", "start": 0.0, "end": 1.0}
        ]
    }
    response = client.post("/render_timeline", json=payload)
    assert response.status_code == 200
    content_disposition = response.headers.get("content-disposition", "")
    assert "attachment" in content_disposition.lower()
    assert "filename=" in content_disposition.lower()
    content_type = response.headers.get("content-type", "")
    assert "video" in content_type or "octet-stream" in content_type
    assert len(response.content) > 1000
