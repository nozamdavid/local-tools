import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ScrollToTop } from './components/ScrollToTop';
import { Home } from './pages/Home';
import { MediaIndex } from './pages/MediaIndex';
import { DesignSystem } from './pages/DesignSystem';
import { NotFound } from './pages/NotFound';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { tools } from './tools/registry';
import { useI18n } from './lib/i18n';

function LoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="page-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {t('Loading tool…')}
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
          <Route path="/file" element={<MediaIndex key="file" media="file" />} />
          <Route path="/video" element={<MediaIndex key="video" media="video" />} />
          <Route path="/image" element={<MediaIndex key="image" media="image" />} />
          <Route path="/pdf" element={<MediaIndex key="pdf" media="pdf" />} />
          <Route path="/3d" element={<MediaIndex key="3d" media="3d" />} />
          <Route path="/design" element={<DesignSystem />} />
          {tools.map((tool) => {
            const Component = tool.component;
            return (
              <Route
                key={tool.id}
                path={tool.path}
                element={
                  <RouteErrorBoundary>
                    <Suspense fallback={<LoadingFallback />}>
                      <Component />
                    </Suspense>
                  </RouteErrorBoundary>
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
