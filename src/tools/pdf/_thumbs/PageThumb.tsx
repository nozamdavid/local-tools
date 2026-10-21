import styles from './PageThumb.module.css';

export interface PageThumbProps {
  /** Thumbnail image of the page as it currently looks (existing rotation applied). */
  src?: string;
  /** Visual page size before the extra rotation, in points. */
  width: number;
  height: number;
  /** Extra clockwise rotation in degrees (multiple of 90) drawn on top of the image. */
  rotation?: number;
  /** Side of the square the thumbnail is fitted into, in CSS pixels. */
  box?: number;
  alt?: string;
}

export function PageThumb({ src, width, height, rotation = 0, box = 140, alt = '' }: PageThumbProps) {
  const turned = rotation % 180 !== 0;
  const visualW = turned ? height : width;
  const visualH = turned ? width : height;
  const scale = Math.min(box / visualW, box / visualH);

  return (
    <div className={styles.slot} style={{ width: box, height: box }}>
      <div className={styles.sheet} style={{ width: visualW * scale, height: visualH * scale }}>
        {src ? (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={styles.img}
            style={{
              width: width * scale,
              height: height * scale,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          />
        ) : (
          <span className={styles.empty}>{src === undefined ? '…' : ''}</span>
        )}
      </div>
    </div>
  );
}
