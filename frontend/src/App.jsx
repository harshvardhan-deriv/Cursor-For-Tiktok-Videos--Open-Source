import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { VideoEditor } from "./components/VideoEditor";
import { Onboarding } from "./components/Onboarding";
import { SelectionScreen } from "./components/SelectionScreen";
import { ThumbnailGenerator } from "./components/ThumbnailGenerator";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Navigate to="/welcome" replace />} />
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/selection" element={<SelectionScreen />} />
          <Route path="/editor" element={<VideoEditor />} />
          <Route path="/thumbnail" element={<ThumbnailGenerator />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
