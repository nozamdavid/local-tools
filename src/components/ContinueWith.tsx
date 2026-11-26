import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createResultFiles, getContinueWithTools, type ResultFileBlob } from '../lib/continueWith';
import { setPendingFiles } from '../lib/handoff';
import { Button } from './Controls';
import styles from './ContinueWith.module.css';
import { useI18n } from '../lib/i18n';
import { localizeToolMeta } from '../tools/registry';
import { getToolIcon } from '../design/tool-icons';

export interface ContinueWithProps {
  results: ResultFileBlob[];
}

export function ContinueWith({ results }: ContinueWithProps) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const outputFiles = useMemo(() => createResultFiles(results), [results]);
  const targets = useMemo(() => getContinueWithTools(pathname, outputFiles), [pathname, outputFiles]);
  const [next, ...more] = targets.map((target) => localizeToolMeta(target));

  if (!next) return null;

  const NextIcon = getToolIcon(next);
  const openTool = (path: string) => {
    setPendingFiles(outputFiles, path);
    navigate(path);
  };

  return (
    <div className={styles.actions} role="group" aria-label={t('Continue with another tool')}>
      <Button
        variant="secondary"
        icon={<NextIcon aria-hidden="true" />}
        onClick={() => openTool(next.path)}
        aria-label={t('Continue with {tool}', { tool: next.title })}
      >
        {t('Continue with {tool}', { tool: next.title })}
      </Button>
      {more.length > 0 && (
        <details className={styles.more}>
          <summary className={styles.summary}>{t('More')}</summary>
          <div className={styles.menu}>
            {more.slice(0, 3).map((tool) => {
              const Icon = getToolIcon(tool);
              return (
                <Button key={tool.id} variant="ghost" icon={<Icon aria-hidden="true" />} onClick={() => openTool(tool.path)}>
                  {tool.title}
                </Button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
