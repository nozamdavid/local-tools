import { Link } from 'react-router-dom';
import { getToolMeta } from '../../registry';
import styles from './PageToolNav.module.css';
import { useI18n } from '../../../lib/i18n';

const PAGE_TOOL_IDS = ['pdf-organize', 'pdf-remove-pages', 'pdf-extract-pages', 'pdf-split'] as const;

export function PageToolNav({ currentId }: { currentId: (typeof PAGE_TOOL_IDS)[number] }) {
  const { t } = useI18n();
  return (
    <nav className={styles.nav} aria-label={t('PDF page tools')}>
      {PAGE_TOOL_IDS.map((id) => {
        const tool = getToolMeta(id);
        const current = id === currentId;
        return (
          <Link key={id} className={current ? styles.current : styles.link} to={tool.path} aria-current={current ? 'page' : undefined}>
            {tool.title}
          </Link>
        );
      })}
    </nav>
  );
}
