import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home, Film, Image, Files, FileText, Box } from 'lucide-react';
import { MediaTile } from '../components/Controls';
import '../design/errors.css';

interface CategoryLink {
  path: string;
  label: string;
  media: 'video' | 'image' | 'file' | 'pdf' | '3d';
  description: string;
  icon: typeof Film;
}

const CATEGORY_LINKS: CategoryLink[] = [
  {
    path: '/video',
    label: 'Video tools',
    media: 'video',
    description: 'Trim, compress, convert, subtitle and transcribe videos.',
    icon: Film,
  },
  {
    path: '/image',
    label: 'Image tools',
    media: 'image',
    description: 'Resize, compress, convert, edit and generate images.',
    icon: Image,
  },
  {
    path: '/file',
    label: 'File & data tools',
    media: 'file',
    description: 'Convert formats, view spreadsheets, inspect and rename files.',
    icon: Files,
  },
  {
    path: '/pdf',
    label: 'PDF tools',
    media: 'pdf',
    description: 'Merge, split, compress, convert, edit, sign and protect PDFs.',
    icon: FileText,
  },
  {
    path: '/3d',
    label: '3D tools',
    media: '3d',
    description: 'Convert, inspect, simplify, transform, split and merge 3D models.',
    icon: Box,
  },
];

export function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · Loconvert';
  }, []);

  return (
    <div className="not-found-page">
      <header className="not-found-header">
        <span className="not-found-badge">404</span>
        <h1 className="not-found-title">Page not found</h1>
        <p className="not-found-desc">
          We couldn’t find the page or tool you’re looking for. It may have moved or the address may be mistyped.
        </p>
      </header>

      <div className="not-found-categories" aria-label="Explore tools by category">
        {CATEGORY_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} className="not-found-card">
              <MediaTile media={item.media} size="sm">
                <Icon aria-hidden="true" />
              </MediaTile>
              <div>
                <div className="not-found-card-title">{item.label}</div>
                <div className="not-found-card-desc">{item.description}</div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="not-found-footer-actions">
        <Link to="/" className="btn btn-secondary">
          <Home aria-hidden="true" />
          Back to all tools
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
