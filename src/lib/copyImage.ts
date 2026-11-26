import { canvasToBlob, decodeImage, imageToCanvas } from './image';

const PNG = 'image/png';

async function toClipboardPng(blob: Blob, filename: string): Promise<Blob> {
  if (!blob.size) throw new Error('The image is empty.');
  if (blob.type === PNG) return blob;

  const file = new File([blob], filename, { type: blob.type });
  const image = await decodeImage(file);
  return canvasToBlob(imageToCanvas(image, image.naturalWidth, image.naturalHeight), PNG);
}

/** Returns a PNG for manual copying when the browser can't write it. Returns null after a successful write. */
export async function copyImage(getImage: () => Blob | Promise<Blob>, filename = 'image'): Promise<Blob | null> {
  const png = Promise.resolve()
    .then(getImage)
    .then((blob) => toClipboardPng(blob, filename));

  const clipboard = navigator.clipboard;
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      // Begin the write during the click, before asynchronous image generation can lose user activation.
      const write = clipboard.write([new ClipboardItem({ [PNG]: png })]);
      await Promise.all([write, png]);
      return null;
    } catch {
      // The same PNG can be copied manually when writes are unavailable or denied.
    }
  }

  return png;
}
