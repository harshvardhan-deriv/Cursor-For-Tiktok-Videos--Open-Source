import React, { useState } from 'react';
import { Wand2, Image, Download, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ThumbnailGenerator.css';

export function ThumbnailGenerator() {
    const [concept, setConcept] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [generatedImage, setGeneratedImage] = useState(null);
    const [snapshots, setSnapshots] = useState([]);
    const navigate = useNavigate();

    React.useEffect(() => {
        const fetchSnapshots = async () => {
            try {
                const response = await axios.get("http://127.0.0.1:8001/media");
                if (response.status === 200) {
                    const mediaWithThumbs = response.data.filter(m => m.thumbnailUrl && m.type === 'video');
                    setSnapshots(mediaWithThumbs);
                }
            } catch (error) {
                console.error("Failed to fetch snapshots", error);
            }
        };
        fetchSnapshots();
    }, []);

    const handleGenerate = () => {
        if (!concept.trim()) return;

        setIsGenerating(true);
        setGeneratedImage(null);

        const steps = [
            "Picking the face from the video...",
            "Looking at the transcript for context...",
            "Picking the title of video...",
            "Choosing background from the video..."
        ];

        let step = 0;
        setLoadingMessage(steps[0]);

        const interval = setInterval(() => {
            step++;
            if (step < steps.length) {
                setLoadingMessage(steps[step]);
            } else {
                clearInterval(interval);
                setIsGenerating(false);
                clearInterval(interval);
                setIsGenerating(false);
                // For demo purposes, we might still fallback to Image.png if no snapshot selected,
                // but ideally the user prompt would generate a NEW image.
                // Here we keep the existing "simulation" or set it to a chosen snapshot if we had generation logic.
                setGeneratedImage("/Image.png");
            }
        }, 1500);
    };

    const handleSnapshotClick = (url) => {
        setGeneratedImage(url);
    };

    return (
        <div className="thumbnail-container">
            <button className="back-button" onClick={() => navigate('/selection')}>
                <ArrowLeft size={20} /> Back
            </button>

            <div className="generator-content">
                <h1 className="generator-title">
                    <Wand2 className="icon-title" /> AI Thumbnail Generator
                </h1>
                <p className="generator-subtitle">Describe your video concept to generate a viral thumbnail.</p>

                {/* Snapshot Gallery */}
                {snapshots.length > 0 && (
                    <div className="snapshot-gallery">
                        <h3>Source Snapshots</h3>
                        <div className="snapshot-grid">
                            {snapshots.map((snap) => (
                                <div key={snap.id} className="snapshot-item" onClick={() => handleSnapshotClick(snap.thumbnailUrl)}>
                                    <img src={snap.thumbnailUrl} alt={snap.filename} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="input-group">
                    <input
                        type="text"
                        placeholder="e.g. Shocked face pointing at a giant burger with text 'OMG!'"
                        value={concept}
                        onChange={(e) => setConcept(e.target.value)}
                        className="concept-input"
                    />
                    <button
                        className="button primary"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Generating...' : 'Generate'}
                    </button>
                </div>

                <div className="preview-area">
                    {isGenerating ? (
                        <div className="placeholder-box" style={{ borderColor: 'var(--color-tiktok-cyan)' }}>
                            <div className="loading-spinner"></div>
                            <p>{loadingMessage}</p>
                        </div>
                    ) : generatedImage ? (
                        <div className="result-card">
                            <img src={generatedImage} alt="Generated Thumbnail" />
                            <div className="result-actions">
                                <button className="button outline small">
                                    <Download size={14} /> Download
                                </button>
                                <button className="button outline small" onClick={handleGenerate}>
                                    Regenerate
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="placeholder-box">
                            <Image size={48} color="#444" />
                            <p>Generated thumbnail will appear here</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
