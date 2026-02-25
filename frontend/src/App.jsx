import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { VideoEditor } from "./components/VideoEditor";
import { Onboarding } from "./components/Onboarding";
import { SelectionScreen } from "./components/SelectionScreen";
import { ThumbnailGenerator } from "./components/ThumbnailGenerator";
import "./App.css";

// #region agent log
class EditorErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    fetch('http://127.0.0.1:7244/ingest/b7f9bb07-2a1d-4c55-9898-57ec776c5f82', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '057623' },
      body: JSON.stringify({
        sessionId: '057623',
        location: 'App.jsx:EditorErrorBoundary',
        message: 'VideoEditor render error',
        data: { error: String(error), componentStack: errorInfo?.componentStack ?? '' },
        timestamp: Date.now(),
        hypothesisId: 'editor_crash',
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto', color: '#fff', fontFamily: 'sans-serif' }}>
          <h2>Editor error</h2>
          <pre style={{ background: '#333', padding: '1rem', overflow: 'auto', fontSize: 12 }}>
            {this.state.error?.message}
          </pre>
          <p><Link to="/welcome" style={{ color: '#69c' }}>Back to welcome</Link></p>
        </div>
      );
    }
    return this.props.children;
  }
}
// #endregion

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Navigate to="/welcome" replace />} />
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/selection" element={<SelectionScreen />} />
          <Route path="/editor" element={
            <EditorErrorBoundary>
              <VideoEditor />
            </EditorErrorBoundary>
          } />
          <Route path="/thumbnail" element={<ThumbnailGenerator />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
