import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { MediaTile } from '../components/Controls';
import '../design/errors.css';
import { useI18n } from '../lib/i18n';
import { MEDIA_LIST, localizeMediaInfo } from '../design/media';

export function NotFound() {
  const { t } = useI18n();

  return (
    <div className="not-found-page">
      <header className="not-found-header">
        <span className="not-found-badge">404</span>
        <h1 className="not-found-title">{t('Page not found')}</h1>
        <p className="not-found-desc">
          {t('We couldn’t find the page or tool you’re looking for. It may have moved or the address may be mistyped.')}
        </p>
      </header>

      <div className="not-found-categories" aria-label={t('Explore tools by category')}>
        {MEDIA_LIST.map((rawInfo) => {
          const item = localizeMediaInfo(rawInfo);
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
          {t('Back to all tools')}
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
