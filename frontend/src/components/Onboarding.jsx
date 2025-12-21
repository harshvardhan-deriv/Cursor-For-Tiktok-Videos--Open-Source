
import React, { useState, useRef } from 'react';
import { Upload, ArrowRight, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Onboarding.css';

export function Onboarding() {
    const [description, setDescription] = useState('');
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
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

        // Upload files
        const uploadPromises = files.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);

            try {
                await axios.post("http://127.0.0.1:8001/upload", formData, {
                    headers: { "Content-Type": "multipart/form-data" },
                });
                return true;
            } catch (error) {
                console.error(`Failed to upload ${file.name}`, error);
                return false;
            }
        });

        await Promise.all(uploadPromises);

        // Save description context if needed (can be local storage or separate endpoint)
        // For now, we just pass control to editor

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
                            accept="video/*"
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
                    {isUploading ? 'Uploading...' : 'Next Step'} <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );
}
