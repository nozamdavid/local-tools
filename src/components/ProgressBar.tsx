export interface ProgressBarProps {
  value: number; // 0 to 1
  label?: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const percent = Math.round(clamped * 100);

  return (
    <div className="progress-bar-container">
      <div className="progress-header">
        <span>{label || 'Processing...'}</span>
        <span>{percent}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
