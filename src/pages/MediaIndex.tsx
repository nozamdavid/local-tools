import { CategorySections } from '../components/CategorySections';
import type { Media } from '../tools/registry';

const COPY: Record<Media, { title: string; description: string }> = {
  file: {
    title: 'File tools',
    description: 'Convert between any file formats on your device. Nothing is uploaded.',
  },
  video: {
    title: 'Video tools',
    description: 'Convert, compress, edit and transcribe videos on your device. Nothing is uploaded.',
  },
  image: {
    title: 'Image tools',
    description: 'Resize, convert, edit and generate images on your device. Nothing is uploaded.',
  },
  pdf: {
    title: 'PDF tools',
    description: 'Merge, split, compress, convert, edit and sign PDFs on your device. Nothing is uploaded.',
  },
};

export function MediaIndex({ media }: { media: Media }) {
  const copy = COPY[media];

  return (
    <div>
      <section className="hero">
        <h1 className="hero-title">{copy.title}</h1>
        <p className="hero-description">{copy.description}</p>
      </section>

      <CategorySections media={media} />
    </div>
  );
}
