
import React, { useState, useRef } from 'react';
import { Upload, ArrowRight, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Onboarding.css';

export function Onboarding() {
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [status, setStatus] = useState('');
    const fileInputRef = useRef(null);
    const navigate = useNavigate();

    const handleFileChange = (e) => {
        if (e.target.files) {
            setFiles(Array.from(e.target.files));
        }
    };

    const handleNext = async () => {
        if (!description.trim()) {
            alert("Please enter a description");
            return;
        }
        if (files.length === 0) {
            alert("Please upload at least one video file");
            return;
        }

        setIsUploading(true);
        setStatus('Uploading...');

        // Upload files and capture filenames (backend may return final filename after normalization)
        const uploadResults = await Promise.all(files.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);
            try {
                const res = await axios.post("http://127.0.0.1:8001/upload", formData, {
                    headers: { "Content-Type": "multipart/form-data" },
                });
                const filename = (res.data && res.data.filename) ? res.data.filename : file.name;
                return { ok: true, filename, file };
            } catch (error) {
                console.error(`Failed to upload ${file.name}`, error);
                return { ok: false, filename: null, file };
            }
        }));

        // Pick first successful video upload for viral generation (by response filename or original file name)
        const firstVideo = uploadResults.find((r) => {
            if (!r.ok || !r.file) return false;
            const name = r.filename || r.file.name || '';
            return /\.(mp4|mov|avi|webm)$/i.test(name);
        });
        const videoFilename = firstVideo ? (firstVideo.filename || firstVideo.file?.name) : null;

        if (videoFilename) {
            setStatus('Generating viral clips...');
            try {
                await axios.post(
                    "http://127.0.0.1:8001/auto_generate",
                    { filename: videoFilename, description: description.trim() || undefined },
                    { timeout: 300000, headers: { "Content-Type": "application/json" } }
                );
            } catch (err) {
                console.warn("Viral generation failed or timed out; you can generate from the editor.", err);
            }
        }

        setStatus('');
        setIsUploading(false);
        navigate('/editor');
    };

    return (
        <div className="onboarding-container">
            <div className="onboarding-card">
                <h1 className="onboarding-title">
                    <Video className="icon-title" /> Start Your Project
                </h1>
                <p className="onboarding-subtitle">Tell us about the TikTok video you want to create.</p>

                <div className="form-group">
                    <label>Description / Concept</label>
                    <textarea
                        placeholder="e.g. A fast-paced travel vlog about my trip to Japan..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                    />
                </div>

                <div className="form-group">
                    <label>Upload Raw Footage</label>
                    <div
                        className="upload-box"
                        onClick={() => fileInputRef.current.click()}
                    >
                        <Upload size={32} />
                        <p>Click to upload video files</p>
                        <input
                            type="file"
                            multiple
                            accept="video/*,.mp4,.mov,.avi,.webm"
                            className="hidden-input"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                        />
                    </div>
                    {files.length > 0 && (
                        <div className="file-list">
                            <p>{files.length} files selected:</p>
                            <ul>
                                {files.map((f, i) => <li key={i}>{f.name}</li>)}
                            </ul>
                        </div>
                    )}
                </div>

                <button className="button primary large" onClick={handleNext} disabled={isUploading}>
                    {isUploading ? (status || 'Uploading...') : 'Next Step'} <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );
}
