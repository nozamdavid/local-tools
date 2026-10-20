import { Link } from 'react-router-dom';
import { CategorySections } from '../components/CategorySections';

export function Home() {
  return (
    <div>
      <section className="hero">
        <h1 className="hero-title">
          Private media tools that run in <span className="hero-highlight">your browser</span>
        </h1>
        <p className="hero-description">
          Fast, free, and private. Convert, compress, edit, and transcribe your videos and images with zero uploads.
          Everything runs entirely on your device using WebAssembly.
        </p>
      </section>

      <section className="file-converter-promo" style={{ marginBottom: '3.5rem' }}>
        <Link
          to="/file-converter"
          className="file-converter-promo-link"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.75rem 2rem',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-lg, 12px)',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'all 0.2s ease',
            boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.04))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', minWidth: 0, flex: '1 1 240px' }}>
            <span style={{ fontSize: '2.5rem', flexShrink: 0 }}>🔄</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0 }}>File Format Converter</h2>
                <span className="badge badge-brand" style={{ fontSize: '0.75rem' }}>Universal</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-text-muted)' }}>
                Drop any image, video, audio, document or text file. Real content detection with instant on-device conversion.
              </p>
            </div>
          </div>
          <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-brand)', whiteSpace: 'nowrap' }}>
            Convert any file →
          </span>
        </Link>
      </section>

      <section className="media-section" id="file">
        <h2 className="media-title">
          <Link to="/file">File tools</Link>
        </h2>
        <CategorySections media="file" />
      </section>

      <section className="media-section" id="video">
        <h2 className="media-title">
          <Link to="/video">Video tools</Link>
        </h2>
        <CategorySections media="video" />
      </section>

      <section className="media-section" id="image">
        <h2 className="media-title">
          <Link to="/image">Image tools</Link>
        </h2>
        <CategorySections media="image" />
      </section>

      <section className="media-section" id="pdf">
        <h2 className="media-title">
          <Link to="/pdf">PDF tools</Link>
        </h2>
        <CategorySections media="pdf" />
      </section>
    </div>
  );
}
