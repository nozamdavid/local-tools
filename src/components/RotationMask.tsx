import styles from './RotationMask.module.css';

type Size = { width: number; height: number };

/** Overlay a preview of the entire rotated source. All measurements are in source pixels. */
export function RotationMask({ kept, surround }: { kept: Size & { x?: number; y?: number }; surround: Size }) {
  const x = kept.x ?? (surround.width - kept.width) / 2;
  const y = kept.y ?? (surround.height - kept.height) / 2;
  return (
    <div className={styles.mask} aria-hidden="true">
      <div
        className={styles.frame}
        style={{
          left: `${(100 * x) / surround.width}%`,
          top: `${(100 * y) / surround.height}%`,
          width: `${(100 * kept.width) / surround.width}%`,
          height: `${(100 * kept.height) / surround.height}%`,
        }}
      >
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
