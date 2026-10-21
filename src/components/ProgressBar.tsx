export interface ProgressBarProps {
  value: number; // 0 to 1
  label?: string;
  /** Unknown duration: shows a moving bar instead of a percentage */
  indeterminate?: boolean;
}

export function ProgressBar({ value, label, indeterminate = false }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);
  const text = label || 'Processing…';

  return (
    <div className="progress-bar-container">
      <div className="progress-header">
        {/* Only the label is a live region: it announces each new stage once, while the percentage stays out of the speech queue. */}
        <span role="status">
          <span className="spinner" aria-hidden="true" />
          {text}
        </span>
        {!indeterminate && (
          <span className="progress-percent" aria-hidden="true">
            {percent}%
          </span>
        )}
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={text}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-valuetext={indeterminate ? 'In progress' : `${percent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`progress-fill ${indeterminate ? 'progress-fill-indeterminate' : ''}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
