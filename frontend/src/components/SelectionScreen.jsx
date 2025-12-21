import React from 'react';
import { Video, Image, Film } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './SelectionScreen.css';

export function SelectionScreen() {
    const navigate = useNavigate();

    const handleSelect = (option) => {
        if (option === 'video') {
            navigate('/editor');
        } else {
            navigate('/thumbnail');
        }
    };
    return (
        <div className="selection-container">
            <h1 className="selection-title">What would you like to create?</h1>

            <div className="cards-row">
                <div className="selection-card" onClick={() => handleSelect('video')}>
                    <div className="card-icon">
                        <Film size={48} />
                    </div>
                    <h3>TikTok Video</h3>
                    <p>Edit and produce a viral TikTok video from your raw footage.</p>
                </div>

                <div className="selection-card" onClick={() => handleSelect('thumbnail')}>
                    <div className="card-icon">
                        <Image size={48} />
                    </div>
                    <h3>TikTok Thumbnail</h3>
                    <p>Generate a click-worthy thumbnail for your video using AI.</p>
                </div>
            </div>
        </div>
    );
}
