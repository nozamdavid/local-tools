import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ScrollToTop } from './components/ScrollToTop';
import { Home } from './pages/Home';
import { MediaIndex } from './pages/MediaIndex';
import { tools } from './tools/registry';

function LoadingFallback() {
  return (
    <div className="coming-soon-box">
      <div className="coming-soon-badge">Loading...</div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/file" element={<MediaIndex media="file" />} />
          <Route path="/video" element={<MediaIndex media="video" />} />
          <Route path="/image" element={<MediaIndex media="image" />} />
          <Route path="/pdf" element={<MediaIndex media="pdf" />} />
          {tools.map((tool) => {
            const Component = tool.component;
            return (
              <Route
                key={tool.id}
                path={tool.path}
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <Component />
                  </Suspense>
                }
              />
            );
          })}
          {/* Legacy video URLs: /<id> -> /video/<id> */}
          {tools
            .filter((tool) => tool.media === 'video')
            .map((tool) => (
              <Route key={`legacy-${tool.id}`} path={`/${tool.id}`} element={<Navigate to={tool.path} replace />} />
            ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
