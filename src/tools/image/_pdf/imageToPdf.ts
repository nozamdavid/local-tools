import { PDFDocument } from 'pdf-lib';
import { decodeImage } from '../../../lib/image';

export type PageSizeOption = 'fit' | 'a4' | 'letter';
export type OrientationOption = 'auto' | 'portrait' | 'landscape';
export type MarginOption = 'none' | 'small' | 'large';

export interface ImageToPdfOptions {
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  margin: MarginOption;
  splitTallScreenshots?: boolean;
  onProgress?: (current: number, total: number) => void;
}

const PAGE_DIMENSIONS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
};

const MARGIN_POINTS: Record<MarginOption, number> = {
  none: 0,
  small: 18,
  large: 36,
};

export async function imagesToPdf(
  files: File[],
  options: ImageToPdfOptions
): Promise<Blob> {
  if (files.length === 0) {
    throw new Error('Please select at least one image.');
  }

  const pdfDoc = await PDFDocument.create();
  const marginPt = MARGIN_POINTS[options.margin];

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    options.onProgress?.(idx, files.length);

    // If split tall screenshots is active, we check if image is tall
    if (options.splitTallScreenshots) {
      const img = await decodeImage(file);
      const imgWidth = img.naturalWidth || img.width;
      const imgHeight = img.naturalHeight || img.height;
      const a4Ratio = 841.89 / 595.28;

      if (imgHeight / imgWidth > 1.45) {
        // Split vertically into A4 proportion slices
        const sliceHeight = Math.round(imgWidth * a4Ratio);
        const sliceCount = Math.ceil(imgHeight / sliceHeight);

        for (let s = 0; s < sliceCount; s++) {
          const sy = s * sliceHeight;
          const sHeight = Math.min(sliceHeight, imgHeight - sy);

          const canvas = document.createElement('canvas');
          canvas.width = imgWidth;
          canvas.height = sHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D context unavailable');

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, sy, imgWidth, sHeight, 0, 0, imgWidth, sHeight);

          const sliceBlob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, 'image/jpeg', 0.92)
          );
          canvas.width = 0;
          canvas.height = 0;

          if (!sliceBlob) throw new Error('Failed to encode image slice');
          const sliceBytes = new Uint8Array(await sliceBlob.arrayBuffer());
          const embeddedSlice = await pdfDoc.embedJpg(sliceBytes);

          // Add A4 page
          const page = pdfDoc.addPage([595.28, 841.89]);
          const scale = 595.28 / imgWidth;
          const drawH = sHeight * scale;
          const y = 841.89 - drawH; // align to top
          page.drawImage(embeddedSlice, {
            x: 0,
            y,
            width: 595.28,
            height: drawH,
          });
        }
        continue;
      }
    }

    // Normal embedding
    let embeddedImage;
    let imgWidth = 0;
    let imgHeight = 0;

    // Try direct embedding for JPEG/PNG
    if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        embeddedImage = await pdfDoc.embedJpg(bytes);
        imgWidth = embeddedImage.width;
        imgHeight = embeddedImage.height;
      } catch {
        // fallback to decoding
      }
    } else if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        embeddedImage = await pdfDoc.embedPng(bytes);
        imgWidth = embeddedImage.width;
        imgHeight = embeddedImage.height;
      } catch {
        // fallback to decoding
      }
    }

    if (!embeddedImage) {
      const img = await decodeImage(file);
      imgWidth = img.naturalWidth || img.width;
      imgHeight = img.naturalHeight || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = imgWidth;
      canvas.height = imgHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.drawImage(img, 0, 0);

      const hasAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/svg+xml';
      let blob: Blob | null;

      if (hasAlpha) {
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error('Failed to encode canvas to PNG');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        embeddedImage = await pdfDoc.embedPng(bytes);
      } else {
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error('Failed to encode canvas to JPEG');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        embeddedImage = await pdfDoc.embedJpg(bytes);
      }
    }

    // Determine page size and orientation
    let pageWidth: number;
    let pageHeight: number;

    if (options.pageSize === 'fit') {
      pageWidth = imgWidth + marginPt * 2;
      pageHeight = imgHeight + marginPt * 2;
    } else {
      const baseDim = PAGE_DIMENSIONS[options.pageSize];
      let isLandscape = false;
      if (options.orientation === 'landscape') {
        isLandscape = true;
      } else if (options.orientation === 'auto') {
        isLandscape = imgWidth > imgHeight;
      }

      if (isLandscape) {
        pageWidth = Math.max(baseDim.width, baseDim.height);
        pageHeight = Math.min(baseDim.width, baseDim.height);
      } else {
        pageWidth = Math.min(baseDim.width, baseDim.height);
        pageHeight = Math.max(baseDim.width, baseDim.height);
      }
    }

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // Fit contain inside printable area
    const printableW = Math.max(1, pageWidth - marginPt * 2);
    const printableH = Math.max(1, pageHeight - marginPt * 2);

    const scale = Math.min(printableW / imgWidth, printableH / imgHeight);
    const drawW = imgWidth * scale;
    const drawH = imgHeight * scale;

    const x = marginPt + (printableW - drawW) / 2;
    const y = marginPt + (printableH - drawH) / 2;

    page.drawImage(embeddedImage, {
      x,
      y,
      width: drawW,
      height: drawH,
    });
  }

  options.onProgress?.(files.length, files.length);
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}
