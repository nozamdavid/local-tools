import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { translate } from '../lib/i18n';

export type Media = 'video' | 'image' | 'pdf' | 'file' | '3d';

export type CategoryId =
  | 'file-convert'
  | 'file-data'
  | 'file-utility'
  | 'video-edit'
  | 'video-convert'
  | 'video-audio'
  | 'video-ai'
  | 'video-utility'
  | 'image-optimize'
  | 'image-convert'
  | 'image-edit'
  | 'image-transform'
  | 'image-effects'
  | 'image-pdf'
  | 'image-social'
  | 'image-bulk'
  | 'image-color'
  | 'image-metadata'
  | 'image-generate'
  | 'pdf-organize'
  | 'pdf-optimize'
  | 'pdf-to'
  | 'pdf-from'
  | 'pdf-edit'
  | 'pdf-security'
  | 'pdf-ai'
  | '3d-format'
  | '3d-edit'
  | '3d-inspect';

export interface Category {
  id: CategoryId;
  media: Media;
  title: string;
  description: string;
}

export interface ToolMeta {
  /** Unique id. Video tools: the slug (`compress`). Image tools: `img-<slug>`. PDF tools: `pdf-<slug>`. File tools: slug. */
  id: string;
  /** URL / folder slug. Video: same as id. Image and PDF: folder name under `src/tools/<media>/`. */
  slug: string;
  media: Media;
  path: string;
  title: string;
  description: string;
  icon: string;
  category: CategoryId;
  tags: string[];
  popular?: boolean;
}

export interface ToolDef extends ToolMeta {
  component: LazyExoticComponent<ComponentType>;
}

export const categories: Category[] = [
  {
    id: 'file-convert',
    media: 'file',
    title: 'Format converters',
    description: 'Convert between file formats including MHTML, GPX and KML',
  },
  {
    id: 'file-data',
    media: 'file',
    title: 'Data & spreadsheets',
    description: 'Convert, inspect, and view CSV, JSON, and text spreadsheets',
  },
  {
    id: 'file-utility',
    media: 'file',
    title: 'File utilities',
    description: 'Inspect file headers, verify hashes, rename files and check video health',
  },

  { id: 'video-edit', media: 'video', title: 'Edit', description: 'Trim, crop, loop, speed up, resize, merge and overlay videos' },
  { id: 'video-convert', media: 'video', title: 'Convert & compress', description: 'Change video formats and shrink file sizes' },
  { id: 'video-audio', media: 'video', title: 'Audio', description: 'Extract, remove, boost or add audio tracks' },
  { id: 'video-ai', media: 'video', title: 'AI', description: 'Transcripts, subtitles and background removal with on-device AI' },
  { id: 'video-utility', media: 'video', title: 'Utilities', description: 'Inspect media files and calculate playback speeds' },

  { id: 'image-optimize', media: 'image', title: 'Resize & compress', description: 'Make images smaller in dimensions or file size' },
  { id: 'image-convert', media: 'image', title: 'Format converters', description: 'Convert between JPG, PNG, WEBP, HEIC, SVG and more' },
  { id: 'image-edit', media: 'image', title: 'Editing', description: 'Crop, adjust, annotate, watermark and remove backgrounds' },
  { id: 'image-transform', media: 'image', title: 'Transform & layout', description: 'Rotate, flip, round, pad, merge and build collages' },
  { id: 'image-effects', media: 'image', title: 'Effects', description: 'Sketch, grayscale, invert and meme effects' },
  { id: 'image-pdf', media: 'image', title: 'PDF & documents', description: 'Turn images, PDFs and Word files into each other' },
  {
    id: 'image-social',
    media: 'image',
    title: 'Social media',
    description: 'Presets for covers, banners, stories, thumbnails and avatars',
  },
  { id: 'image-bulk', media: 'image', title: 'Bulk processing', description: 'Resize, compress and convert many images at once' },
  { id: 'image-color', media: 'image', title: 'Colour', description: 'Pick colours, build palettes and check contrast' },
  { id: 'image-metadata', media: 'image', title: 'Metadata & developer', description: 'EXIF data, favicons and Base64 encoding' },
  { id: 'image-generate', media: 'image', title: 'Generators', description: 'Create QR codes, barcodes and printable labels' },

  { id: 'pdf-organize', media: 'pdf', title: 'Organize', description: 'Merge, split, reorder and remove pages' },
  { id: 'pdf-optimize', media: 'pdf', title: 'Optimize', description: 'Compress, repair and make scanned PDFs searchable' },
  { id: 'pdf-to', media: 'pdf', title: 'Convert to PDF', description: 'Turn images, Word, Excel, PowerPoint and HTML into PDF' },
  { id: 'pdf-from', media: 'pdf', title: 'Convert from PDF', description: 'Turn PDFs into images, Word, Excel, PowerPoint and Markdown' },
  { id: 'pdf-edit', media: 'pdf', title: 'Edit', description: 'Rotate, crop, number, watermark, annotate and fill forms' },
  { id: 'pdf-security', media: 'pdf', title: 'Security', description: 'Lock, unlock, sign, redact and compare PDFs' },
  { id: 'pdf-ai', media: 'pdf', title: 'AI', description: 'Summarize and translate PDFs with on-device AI' },

  { id: '3d-format', media: '3d', title: 'Convert', description: 'Convert STL, OBJ, PLY and 3MF meshes, or import CAD files' },
  { id: '3d-edit', media: '3d', title: 'Edit & transform', description: 'Simplify, transform, reverse normals, split and merge 3D meshes' },
  { id: '3d-inspect', media: '3d', title: 'Inspect', description: 'Measure dimensions, volume, surface area and topology' },
];

function fileTool(
  slug: string,
  title: string,
  description: string,
  icon: string,
  category: CategoryId,
  tags: string[],
  popular?: boolean,
): ToolMeta {
  return { id: slug, slug, media: 'file', path: `/${slug}`, title, description, icon, category, tags, ...(popular ? { popular } : {}) };
}

function video(
  id: string,
  title: string,
  description: string,
  icon: string,
  category: CategoryId,
  tags: string[],
  popular?: boolean,
): ToolMeta {
  return { id, slug: id, media: 'video', path: `/video/${id}`, title, description, icon, category, tags, ...(popular ? { popular } : {}) };
}

function image(
  slug: string,
  title: string,
  description: string,
  icon: string,
  category: CategoryId,
  tags: string[],
  popular?: boolean,
): ToolMeta {
  return {
    id: `img-${slug}`,
    slug,
    media: 'image',
    path: `/image/${slug}`,
    title,
    description,
    icon,
    category,
    tags,
    ...(popular ? { popular } : {}),
  };
}

function pdf(
  slug: string,
  title: string,
  description: string,
  icon: string,
  category: CategoryId,
  tags: string[],
  popular?: boolean,
): ToolMeta {
  return {
    id: `pdf-${slug}`,
    slug,
    media: 'pdf',
    path: `/pdf/${slug}`,
    title,
    description,
    icon,
    category,
    tags,
    ...(popular ? { popular } : {}),
  };
}

function three(
  slug: string,
  title: string,
  description: string,
  icon: string,
  category: CategoryId,
  tags: string[],
  popular?: boolean,
): ToolMeta {
  return {
    id: `three-${slug}`,
    slug,
    media: '3d',
    path: `/3d/${slug}`,
    title,
    description,
    icon,
    category,
    tags,
    ...(popular ? { popular } : {}),
  };
}

export const TOOL_METAS: ToolMeta[] = [
  // File: Format converters
  fileTool(
    'file-converter',
    'File format converter',
    'Convert supported files, extract OpenDocument content to text, HTML or PDF, export spreadsheet data, and identify some legacy formats that need LibreOffice export',
    '🔄',
    'file-convert',
    ['libreoffice', 'openoffice', 'opendocument', 'odf', 'odt', 'ods', 'odp', 'spreadsheet'],
    true,
  ),
  fileTool(
    'mhtml-to-html',
    'MHTML to HTML',
    'Unpack MHTML web archives into standalone HTML with embedded assets',
    '🌐',
    'file-convert',
    ['convert', 'html', 'mhtml', 'archive', 'extract'],
    true,
  ),
  fileTool('gpx-kml', 'GPX ↔ KML', 'Convert GPS tracks, routes, and waypoints between GPX and KML', '🗺️', 'file-convert', [
    'convert',
    'gps',
    'gpx',
    'kml',
    'geo',
  ]),

  fileTool(
    'zip-extract',
    'ZIP Inspector & Extractor',
    'Inspect a ZIP archive and extract its files in your browser',
    '📦',
    'file-utility',
    ['archive', 'zip', 'extract', 'inspect', 'unpack'],
  ),

  // File: Data & spreadsheets
  fileTool(
    'csv-viewer',
    'CSV Viewer',
    'View and search CSV and TSV tables in your browser',
    '📊',
    'file-data',
    ['view', 'table', 'csv', 'tsv', 'search', 'filter'],
    true,
  ),
  fileTool('txt-to-csv', 'TXT to CSV', 'Convert plain text and custom-delimited files into clean CSV', '📄', 'file-data', [
    'convert',
    'csv',
    'tsv',
    'table',
    'text',
  ]),
  fileTool(
    'json-csv',
    'JSON ↔ CSV',
    'Convert between JSON data structures and tabular CSV files',
    '🔄',
    'file-data',
    ['convert', 'json', 'csv', 'data', 'table'],
    true,
  ),

  // File: Utilities
  fileTool(
    'file-inspector',
    'File Inspector',
    'Inspect file headers, hex dumps, MIME signatures, and hash checksums',
    '🔍',
    'file-utility',
    ['metadata', 'developer', 'hex', 'hash', 'privacy'],
    true,
  ),
  fileTool(
    'batch-rename',
    'Batch File Rename',
    'Rename multiple files at once with numbering, patterns and replace',
    '🏷️',
    'file-utility',
    ['bulk', 'rename', 'organize', 'pattern'],
  ),
  fileTool(
    'video-health',
    'Video Health Inspector',
    'Inspect MP4, MOV, MKV, and AVI containers for truncation and corruption',
    '🩺',
    'file-utility',
    ['metadata', 'developer', 'mp4', 'mov', 'mkv', 'avi'],
  ),
  fileTool('css-viewer', 'CSS Viewer', 'Edit CSS and preview it with sample HTML', '🎨', 'file-utility', [
    'developer',
    'css',
    'preview',
    'code',
  ]),

  // Video: Edit
  video('trim', 'Trim', 'Cut the start and end of a video', '✂️', 'video-edit', ['trim', 'mp4', 'webm', 'mov'], true),
  video('crop', 'Crop', 'Crop for social media or remove unwanted parts', '📐', 'video-edit', [
    'crop',
    'social',
    'instagram',
    'youtube',
    'mp4',
  ]),
  video('loop', 'Loop', 'Loop a video up to 10 times', '🔁', 'video-edit', ['loop', 'gif', 'mp4']),
  video('speed', 'Speed', 'Speed up or slow down a video', '⚡', 'video-edit', ['speed', 'audio', 'mp4', 'webm']),
  video('resize', 'Resize', 'Change video resolution', '🖥️', 'video-edit', ['resize', 'social', 'instagram', 'youtube', 'twitter', 'mp4']),
  video('merge', 'Merge', 'Combine multiple videos into one', '🎞️', 'video-edit', ['merge', 'mp4', 'webm']),
  video('overlay', 'Overlay', 'Add an image or text watermark', '🏷️', 'video-edit', ['watermark', 'text', 'png', 'mp4']),

  // Video: Convert & compress
  video(
    'compress',
    'Compress',
    'Reduce video file size by up to 90%',
    '🗜️',
    'video-convert',
    ['compress', 'mp4', 'webm', 'mov', 'mkv'],
    true,
  ),
  video(
    'convert',
    'Convert',
    'Convert video to MP4, WebM, MOV, MKV, GIF and more',
    '🔄',
    'video-convert',
    ['convert', 'mp4', 'webm', 'mov', 'mkv', 'gif', 'avi'],
    true,
  ),

  // Video: Audio
  video(
    'audio-extract',
    'Video to MP3 & Audio Extract',
    'Extract audio from video as MP3, AAC or WAV',
    '🎵',
    'video-audio',
    ['audio', 'convert', 'mp3', 'aac', 'wav', 'video-to-mp3', 'extract'],
    true,
  ),
  video('remove-audio', 'Mute', 'Remove the audio track', '🔇', 'video-audio', ['audio', 'mute', 'privacy', 'mp4', 'webm']),
  video('boost-volume', 'Boost', 'Make a video louder', '🔊', 'video-audio', ['audio', 'volume', 'mp4', 'mp3']),
  video('add-soundtrack', 'Add Soundtrack', 'Add background music', '🎶', 'video-audio', ['audio', 'merge', 'mp3', 'mp4']),
  video('audio-trim', 'Trim Audio', 'Trim an audio file with a waveform preview', '🎚️', 'video-audio', [
    'audio',
    'trim',
    'waveform',
    'cut',
    'mp3',
  ]),

  // Video: AI
  video('video-to-text', 'Video to Text', 'Get a clean text transcript', '📝', 'video-ai', ['ai', 'text', 'transcript', 'audio']),
  video('subtitles', 'Subtitles', 'Auto-generate subtitles', '💬', 'video-ai', ['ai', 'text', 'srt', 'vtt', 'mp4']),
  video('text-behind-video', 'Text Behind Video', 'Place text behind the subject of a video', '🎬', 'video-ai', [
    'ai',
    'text',
    'mp4',
    'webm',
  ]),
  video('text-behind-image', 'Text Behind Image', 'Place text behind the subject of an image', '🖼️', 'video-ai', [
    'ai',
    'text',
    'photo',
    'png',
    'jpg',
  ]),
  video('remove-background', 'Remove Background', 'Make transparent videos with AI', '🪄', 'video-ai', [
    'ai',
    'transparency',
    'webm',
    'mp4',
  ]),

  // Video: Utilities
  video('video-info', 'Video Info', 'Inspect codecs, resolution, bitrate, color space and streams', '🔎', 'video-utility', [
    'metadata',
    'developer',
    'mp4',
    'webm',
    'mkv',
    'mov',
    'avi',
  ]),
  video('media-speed', 'Video Speed Calculator', 'Calculate playback speed for target durations', '⏱️', 'video-utility', [
    'speed',
    'calculator',
    'mp4',
    'webm',
    'audio',
  ]),

  // Image: Resize & compress
  image(
    'compress',
    'Compress Image',
    'Reduce image file size with quality preview',
    '🗜️',
    'image-optimize',
    ['compress', 'jpg', 'png', 'webp', 'jxl'],
    true,
  ),
  image('compress-image', 'Compress to Size', 'Compress images to an exact target file size in KB or MB', '🎯', 'image-optimize', [
    'compress',
    'jpg',
    'png',
    'webp',
    'jxl',
  ]),
  image(
    'resize',
    'Resize Image',
    'Resize by pixels, percentage or preset sizes',
    '📐',
    'image-optimize',
    ['resize', 'jpg', 'png', 'webp'],
    true,
  ),
  image('crop', 'Crop Image', 'Crop with freeform or aspect ratio presets', '✂️', 'image-optimize', ['crop', 'social', 'jpg', 'png']),
  image('svg-optimize', 'Optimize SVG', 'Clean and minify SVG markup while preserving the vector image', '✂️', 'image-optimize', [
    'svg',
    'optimize',
    'minify',
    'vector',
    'compress',
  ]),

  // Image: Format converters
  image(
    'convert',
    'Image Converter',
    'Convert images between JPG, PNG, WEBP, GIF, BMP, AVIF, JXL and more',
    '🔄',
    'image-convert',
    ['convert', 'jpg', 'png', 'webp', 'gif', 'bmp', 'avif', 'jxl'],
    true,
  ),
  image('jpg-to-png', 'JPG to PNG', 'Convert JPEG to lossless PNG', '🔄', 'image-convert', ['convert', 'jpg', 'png'], true),
  image('png-to-jpg', 'PNG to JPG', 'Convert PNG to JPEG with custom background', '🔄', 'image-convert', ['convert', 'png', 'jpg'], true),
  image(
    'image-to-webp',
    'Image to WebP',
    'Convert images to modern WebP format',
    '🔄',
    'image-convert',
    ['convert', 'jpg', 'png', 'webp'],
    true,
  ),
  image('webp-to-jpg', 'WebP to JPG', 'Convert WebP to JPEG', '🔄', 'image-convert', ['convert', 'webp', 'jpg']),
  image('webp-to-png', 'WebP to PNG', 'Convert WebP to PNG', '🔄', 'image-convert', ['convert', 'webp', 'png']),
  image('heic-to-jpg', 'HEIC to JPG', 'Convert iPhone HEIC photos to JPEG', '📱', 'image-convert', ['convert', 'heic', 'jpg'], true),
  image('svg-to-png', 'SVG to PNG', 'Rasterize vector SVG to crisp PNG', '📐', 'image-convert', ['convert', 'svg', 'png']),
  image(
    'image-to-svg',
    'Image to SVG',
    'Convert raster JPG, PNG, and WebP images into vector SVG',
    '📐',
    'image-convert',
    ['convert', 'svg', 'vector', 'png', 'jpg'],
    true,
  ),
  image(
    'icon-converter',
    'Image to Favicon / ICO',
    'Convert supported JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, JXL, and SVG images to favicon.ico at recommended or custom resolutions, or extract ICO frames',
    '⭐',
    'image-convert',
    ['convert', 'favicon', 'ico', 'icon', 'png', 'svg', 'resize', 'webp'],
  ),

  // Image: Editing
  image(
    'remove-bg',
    'Remove Background',
    'Remove backgrounds from photos with on-device AI',
    '🪄',
    'image-edit',
    ['ai', 'transparency', 'png'],
    true,
  ),
  image(
    'photo-editor',
    'Photo Editor',
    'Adjust brightness, contrast, saturation and apply filters',
    '🎨',
    'image-edit',
    ['filter', 'color', 'jpg', 'png'],
    true,
  ),
  image('adjust', 'Adjust Image', 'Fine-tune brightness, contrast, saturation and exposure', '🎚️', 'image-edit', [
    'filter',
    'color',
    'jpg',
    'png',
  ]),
  image('blur', 'Blur Image', 'Apply Gaussian blur or solid redaction to images', '🌫️', 'image-edit', ['filter', 'privacy', 'jpg', 'png']),
  image(
    'signature-cleaner',
    'Signature Cleaner',
    'Clean signature backgrounds to transparent while keeping crisp ink details',
    '✍️',
    'image-edit',
    ['transparency', 'clean', 'privacy', 'png'],
    true,
  ),
  image('compare', 'Compare Images', 'Compare two images side by side and inspect their visual differences', '🆚', 'image-edit', [
    'compare',
    'diff',
    'side-by-side',
    'before-after',
    'visual',
  ]),
  image('sharpen', 'Sharpen Image', 'Make soft photos crisper', '🔍', 'image-edit', ['filter', 'jpg', 'png']),
  image('border', 'Image Border', 'Wrap images in decorative frames', '🖼️', 'image-edit', ['border', 'draw', 'jpg', 'png']),
  image('add-border', 'Add Border', 'Add a solid, gradient or dashed border', '🔲', 'image-edit', ['border', 'color', 'jpg', 'png']),
  image('add-text', 'Add Text to Image', 'Overlay customizable text with Google Fonts', '✍️', 'image-edit', [
    'text',
    'watermark',
    'social',
    'jpg',
    'png',
  ]),
  image('watermark', 'Watermark Image', 'Protect images with repeating or positioned watermarks', '🏷️', 'image-edit', [
    'watermark',
    'privacy',
    'jpg',
    'png',
  ]),
  image('image-annotator', 'Annotate Image', 'Draw arrows, boxes, text and highlights on screenshots', '✏️', 'image-edit', [
    'draw',
    'text',
    'png',
    'jpg',
  ]),

  // Image: Transform & layout
  image(
    'rotate',
    'Rotate Image',
    'Rotate by any angle and flip images',
    '🔃',
    'image-transform',
    ['rotate', 'flip', 'jpg', 'png', 'webp'],
    true,
  ),
  image(
    'circle-crop',
    'Circle Crop',
    'Crop images into a circle with a transparent background',
    '⭕',
    'image-transform',
    ['crop', 'transparency', 'png', 'social', 'instagram'],
    true,
  ),
  image('rounded-corners', 'Rounded Corners', 'Round the corners of an image', '🔳', 'image-transform', [
    'crop',
    'transparency',
    'png',
    'webp',
  ]),
  image('flip', 'Flip Image', 'Mirror images horizontally or vertically', '↔️', 'image-transform', ['flip', 'rotate', 'jpg', 'png']),
  image('padding', 'Add Padding', 'Add space around an image or fit it to a canvas size', '🧱', 'image-transform', [
    'resize',
    'transparency',
    'social',
    'png',
    'jpg',
  ]),
  image('merge', 'Merge Images', 'Join images side by side or stacked', '🪢', 'image-transform', ['merge', 'jpg', 'png', 'webp']),
  image('collage', 'Collage Maker', 'Arrange photos into collage templates', '🗂️', 'image-transform', ['merge', 'jpg', 'png', 'social']),

  // Image: Effects
  image('photo-to-sketch', 'Photo to Sketch', 'Turn photos into sketches, cartoons, sepia or artistic styles', '✏️', 'image-effects', [
    'filter',
    'sketch',
    'jpg',
    'png',
  ]),
  image('grayscale', 'Grayscale', 'Convert images to black and white', '⚫', 'image-effects', ['filter', 'color', 'jpg', 'png']),
  image('invert', 'Invert Colors', 'Invert the colours of an image', '🌘', 'image-effects', ['filter', 'color', 'jpg', 'png']),
  image('meme-generator', 'Meme Generator', 'Add top and bottom captions to make memes', '😂', 'image-effects', [
    'text',
    'social',
    'twitter',
    'jpg',
    'png',
  ]),

  // Image: PDF & documents
  image('image-to-pdf', 'Image to PDF', 'Combine images into a single PDF', '📄', 'image-pdf', [
    'document',
    'convert',
    'merge',
    'jpg',
    'png',
  ]),
  image('pdf-to-image', 'PDF to Image', 'Turn PDF pages into JPG, PNG or WEBP images', '🖨️', 'image-pdf', [
    'document',
    'convert',
    'jpg',
    'png',
    'webp',
  ]),
  image('extract-pdf-images', 'Extract PDF Images', 'Save all PDF pages as images in a ZIP', '📦', 'image-pdf', [
    'extract',
    'bulk',
    'zip',
    'jpg',
    'png',
  ]),
  image('screenshot-to-pdf', 'Screenshot to PDF', 'Turn screenshots into a tidy PDF', '📸', 'image-pdf', [
    'document',
    'convert',
    'png',
    'jpg',
  ]),
  image('docx-to-jpg', 'DOCX to JPG', 'Render Word documents as JPG images', '📃', 'image-pdf', ['docx', 'convert', 'jpg']),
  image('docx-to-png', 'DOCX to PNG', 'Render Word documents as PNG images', '📑', 'image-pdf', ['docx', 'convert', 'png']),

  // Image: Social media
  image('profile-resizer', 'Profile Picture Resizer', 'Make avatars in every platform size at once', '👤', 'image-social', [
    'social',
    'resize',
    'instagram',
    'twitter',
    'linkedin',
    'facebook',
    'youtube',
  ]),
  image('instagram-story', 'Instagram Story Resizer', 'Fit images to 1080×1920 for Instagram stories', '📲', 'image-social', [
    'social',
    'instagram',
    'resize',
    'crop',
  ]),
  image('instagram-profile', 'Instagram Profile Picture', 'Make a 1:1 circular Instagram profile picture', '🤳', 'image-social', [
    'social',
    'instagram',
    'crop',
    'png',
  ]),
  image('thumbnail', 'YouTube Thumbnail Resizer', 'Resize images to 1280×720 YouTube thumbnails', '▶️', 'image-social', [
    'social',
    'youtube',
    'resize',
    'jpg',
  ]),
  image('twitter-header', 'Twitter / X Header', 'Resize images to the 1500×500 Twitter header', '🐦', 'image-social', [
    'social',
    'twitter',
    'resize',
    'crop',
  ]),
  image('linkedin-banner', 'LinkedIn Banner', 'Resize images to the 1584×396 LinkedIn banner', '💼', 'image-social', [
    'social',
    'linkedin',
    'resize',
    'crop',
  ]),
  image('facebook-cover', 'Facebook Cover', 'Resize images to the 820×312 Facebook cover', '📘', 'image-social', [
    'social',
    'facebook',
    'resize',
    'crop',
  ]),
  image('og-image', 'OG Image Maker', 'Make 1200×630 link preview images', '🔗', 'image-social', [
    'social',
    'resize',
    'twitter',
    'facebook',
    'linkedin',
  ]),

  // Image: Bulk processing
  image('bulk-resize', 'Bulk Resize', 'Resize many images at once and download a ZIP', '📚', 'image-bulk', [
    'bulk',
    'resize',
    'zip',
    'jpg',
    'png',
  ]),
  image('bulk-compress', 'Bulk Compress', 'Compress many images at once and download a ZIP', '🗃️', 'image-bulk', [
    'bulk',
    'compress',
    'zip',
    'jpg',
    'webp',
    'jxl',
  ]),
  image('bulk-convert', 'Bulk Convert', 'Convert many images at once and download a ZIP', '🔁', 'image-bulk', [
    'bulk',
    'convert',
    'zip',
    'jpg',
    'png',
    'webp',
    'jxl',
  ]),

  // Image: Colour
  image('color-picker', 'Color Picker', 'Pick exact colours from any image', '🎯', 'image-color', ['color', 'hex', 'png', 'jpg']),
  image('color-palette', 'Color Palette Extractor', 'Extract the dominant colours from an image', '🌈', 'image-color', [
    'color',
    'hex',
    'jpg',
    'png',
  ]),
  image('hex-rgb-converter', 'HEX / RGB Converter', 'Convert colours between HEX, RGB and HSL', '🔢', 'image-color', [
    'color',
    'convert',
    'hex',
    'rgb',
  ]),
  image('color-contrast', 'Color Contrast Checker', 'Check WCAG AA and AAA contrast ratios', '♿', 'image-color', [
    'color',
    'accessibility',
    'text',
  ]),

  // Image: Metadata & developer
  image('exif-viewer', 'EXIF Viewer', 'Read camera, location and date metadata from photos', '🔎', 'image-metadata', [
    'metadata',
    'privacy',
    'jpg',
    'heic',
  ]),
  image('exif-remover', 'EXIF Remover', 'Strip metadata and location data from photos', '🧹', 'image-metadata', [
    'metadata',
    'privacy',
    'jpg',
    'png',
  ]),
  image('favicon-generator', 'Favicon Generator', 'Generate 16–512 px favicons as ICO plus HTML', '⭐', 'image-metadata', [
    'generator',
    'resize',
    'ico',
    'png',
    'svg',
  ]),
  image('base64', 'Image to Base64', 'Encode images as Base64 strings or data URIs', '🧬', 'image-metadata', [
    'convert',
    'base64',
    'developer',
    'png',
    'jpg',
    'svg',
  ]),

  // Image: Generators
  image('qr-code-generator', 'QR Code Generator', 'Create QR codes for URLs, WiFi, email, phone, SMS and vCards', '🔳', 'image-generate', [
    'generator',
    'qr',
    'png',
    'svg',
  ]),
  image(
    'barcode-generator',
    'Barcode Generator',
    'Create Code128, EAN-13, EAN-8, UPC-A, Code39 and ITF-14 barcodes',
    '❚',
    'image-generate',
    ['generator', 'barcode', 'png', 'svg'],
  ),
  image('label-designer', 'Label Designer', 'Design printable labels with text, shapes, QR codes and barcodes', '🏷️', 'image-generate', [
    'generator',
    'text',
    'draw',
    'qr',
    'barcode',
  ]),

  // PDF: Organize
  pdf(
    'merge',
    'Merge PDF',
    'Combine several PDFs into one in the order you choose',
    '🧩',
    'pdf-organize',
    ['merge', 'combine', 'organize'],
    true,
  ),
  pdf(
    'split',
    'Split PDF',
    'Split a PDF by page ranges or into single pages',
    '✂️',
    'pdf-organize',
    ['split', 'separate', 'organize', 'zip'],
    true,
  ),
  pdf('remove-pages', 'Remove Pages', 'Delete selected pages from a PDF', '🗑️', 'pdf-organize', ['delete', 'remove', 'organize']),
  pdf('extract-pages', 'Extract Pages', 'Pull selected pages out into a new PDF', '📤', 'pdf-organize', ['split', 'extract', 'organize']),
  pdf('organize', 'Organize PDF', 'Reorder, rotate, delete and insert blank pages', '🗂️', 'pdf-organize', [
    'organize',
    'reorder',
    'rotate',
    'delete',
  ]),
  pdf('scan-to-pdf', 'Scan to PDF', 'Capture pages with your camera and save them as a PDF', '📷', 'pdf-organize', [
    'scan',
    'camera',
    'convert',
    'capture',
  ]),

  // PDF: Optimize
  pdf('compress', 'Compress PDF', 'Reduce PDF file size', '🗜️', 'pdf-optimize', ['compress', 'shrink', 'optimize'], true),
  pdf('repair', 'Repair PDF', 'Recover content from damaged PDFs', '🛠️', 'pdf-optimize', ['repair', 'fix', 'optimize']),
  pdf('ocr', 'OCR PDF', 'Make scanned PDFs searchable and selectable', '🔤', 'pdf-optimize', ['ocr', 'text', 'ai', 'searchable']),
  pdf(
    'metadata-cleaner',
    'PDF Metadata Cleaner',
    'Clear standard PDF author, title, creator and date fields while preserving page content',
    '🧹',
    'pdf-security',
    ['metadata', 'privacy', 'clean', 'remove', 'author'],
  ),

  // PDF: Convert to PDF
  pdf('jpg-to-pdf', 'JPG to PDF', 'Combine images into a single PDF', '🖼️', 'pdf-to', ['convert', 'jpg', 'png', 'document'], true),
  pdf('word-to-pdf', 'Word to PDF', 'Convert DOCX documents to PDF', '📝', 'pdf-to', ['convert', 'docx', 'word', 'document'], true),
  pdf('powerpoint-to-pdf', 'PowerPoint to PDF', 'Convert PPTX slideshows to PDF', '📽️', 'pdf-to', [
    'convert',
    'pptx',
    'powerpoint',
    'slides',
  ]),
  pdf('excel-to-pdf', 'Excel to PDF', 'Convert XLSX spreadsheets to PDF', '📊', 'pdf-to', ['convert', 'xlsx', 'excel', 'spreadsheet']),
  pdf('html-to-pdf', 'HTML to PDF', 'Convert HTML files to PDF', '🌐', 'pdf-to', ['convert', 'html', 'web', 'document']),

  // PDF: Convert from PDF
  pdf(
    'pdf-to-jpg',
    'PDF to JPG',
    'Turn PDF pages into JPG, PNG or WEBP images',
    '🖨️',
    'pdf-from',
    ['convert', 'jpg', 'png', 'extract'],
    true,
  ),
  pdf(
    'pdf-to-word',
    'PDF to Word',
    'Convert PDFs to editable DOCX documents',
    '📄',
    'pdf-from',
    ['convert', 'docx', 'word', 'document'],
    true,
  ),
  pdf('pdf-to-powerpoint', 'PDF to PowerPoint', 'Convert PDF pages to PPTX slides', '📽️', 'pdf-from', [
    'convert',
    'pptx',
    'powerpoint',
    'slides',
  ]),
  pdf('pdf-to-excel', 'PDF to Excel', 'Pull tables from PDFs into XLSX spreadsheets', '📈', 'pdf-from', [
    'convert',
    'xlsx',
    'excel',
    'spreadsheet',
  ]),
  pdf('pdf-to-markdown', 'PDF to Markdown', 'Convert PDFs to Markdown with headings and lists', '⬇️', 'pdf-from', [
    'convert',
    'markdown',
    'text',
    'document',
  ]),

  // PDF: Edit
  pdf('rotate', 'Rotate PDF', 'Rotate all or selected pages', '🔄', 'pdf-edit', ['rotate', 'turn', 'edit']),
  pdf('page-numbers', 'Add Page Numbers', 'Number pages with your choice of position, size and font', '🔢', 'pdf-edit', [
    'numbering',
    'edit',
    'text',
    'pages',
  ]),
  pdf('watermark', 'Add Watermark', 'Stamp text or an image over PDF pages', '💧', 'pdf-edit', ['watermark', 'stamp', 'edit', 'text']),
  pdf('crop', 'Crop PDF', 'Trim margins or crop pages to an area', '📐', 'pdf-edit', ['crop', 'trim', 'edit']),
  pdf('edit', 'Edit PDF', 'Add text, images, shapes and drawings to a PDF', '✍️', 'pdf-edit', ['annotate', 'edit', 'text', 'draw'], true),
  pdf('forms', 'Fill PDF Forms', 'Fill in and flatten PDF form fields', '🧾', 'pdf-edit', ['forms', 'fill', 'edit']),

  // PDF: Security
  pdf('unlock', 'Unlock PDF', 'Remove the password from a PDF you can open', '🔓', 'pdf-security', [
    'unlock',
    'security',
    'password',
    'decrypt',
  ]),
  pdf('protect', 'Protect PDF', 'Encrypt a PDF with a password', '🔒', 'pdf-security', ['protect', 'security', 'password', 'encrypt']),
  pdf(
    'sign',
    'Sign PDF',
    'Draw, type or upload a signature and place it on pages',
    '🖊️',
    'pdf-security',
    ['signature', 'sign', 'edit', 'draw'],
    true,
  ),
  pdf('redact', 'Redact PDF', 'Permanently black out sensitive areas', '⬛', 'pdf-security', ['redact', 'security', 'privacy', 'blackout']),
  pdf('compare', 'Compare PDF', 'Show text and visual differences between two PDFs', '🆚', 'pdf-security', ['compare', 'diff', 'text']),

  // PDF: AI
  pdf('summarize', 'Summarize PDF', 'Summarize a document with on-device AI', '🧠', 'pdf-ai', ['ai', 'text', 'summary', 'analyze']),
  pdf('translate', 'Translate PDF', 'Translate PDF text with on-device AI', '🌍', 'pdf-ai', ['ai', 'text', 'translate', 'language']),

  // 3D: Format converters
  three(
    'convert',
    '3D Format Converter',
    'Convert between 3D mesh formats (STL, OBJ, PLY, 3MF) and import CAD files (STEP, IGES, BREP)',
    '🔄',
    '3d-format',
    ['convert', 'mesh', 'stl', 'obj', 'ply', '3mf', 'cad', 'step'],
    true,
  ),

  // 3D: Edit & transform
  three(
    'simplify',
    '3D Mesh Simplifier',
    'Reduce polygon count and file size while preserving geometric fidelity',
    '📉',
    '3d-edit',
    ['simplify', 'decimate', 'optimize', 'polygon', 'mesh', 'stl', 'obj', '3mf'],
    true,
  ),
  three('transform', '3D Mesh Transform', 'Scale, rotate, center, and ground 3D models with unit conversions', '📐', '3d-edit', [
    'transform',
    'scale',
    'rotate',
    'units',
    'center',
    'ground',
    'mesh',
  ]),
  three(
    'normals',
    '3D Face Winding & Normals Inverter',
    'Invert triangle face winding globally to fix inside-out geometry and slicing errors.',
    '🔁',
    '3d-edit',
    ['normals', 'winding', 'invert', 'flip', 'faces', 'repair', 'mesh'],
  ),
  three(
    'split',
    '3D Component Splitter',
    'Split disconnected shells into individual parts and export separately or as ZIP',
    '✂️',
    '3d-edit',
    ['split', 'separate', 'shells', 'components', 'parts', 'mesh', 'zip'],
  ),
  three('merge', '3D Mesh Merger', 'Combine multiple 3D models into a single unified mesh file', '🧩', '3d-edit', [
    'merge',
    'combine',
    'join',
    'batch',
    'mesh',
  ]),

  // 3D: Inspect
  three(
    'inspect',
    '3D Mesh Inspector',
    'Inspect bounding box, surface area, volume, and manifold watertight topology',
    '🔍',
    '3d-inspect',
    ['inspect', 'dimensions', 'volume', 'area', 'watertight', 'manifold', 'mesh'],
    true,
  ),
];

const videoLoaders = import.meta.glob<{ default: ComponentType }>('./*/Tool.tsx');
const imageLoaders = import.meta.glob<{ default: ComponentType }>('./image/*/Tool.tsx');
const pdfLoaders = import.meta.glob<{ default: ComponentType }>('./pdf/*/Tool.tsx');
const threeLoaders = import.meta.glob<{ default: ComponentType }>('./3d/*/Tool.tsx');

function loaderFor(meta: ToolMeta): () => Promise<{ default: ComponentType }> {
  const key = meta.media === 'video' || meta.media === 'file' ? `./${meta.slug}/Tool.tsx` : `./${meta.media}/${meta.slug}/Tool.tsx`;
  const loaders =
    meta.media === 'image' ? imageLoaders : meta.media === 'pdf' ? pdfLoaders : meta.media === '3d' ? threeLoaders : videoLoaders;
  const loader = loaders[key];
  if (!loader) {
    console.warn(`Tool component deferred or missing: ${key}`);
    return () =>
      Promise.resolve({
        default: () => null,
      });
  }
  return loader;
}

export const tools: ToolDef[] = TOOL_METAS.map((meta) => ({ ...meta, component: lazy(loaderFor(meta)) }));

export function localizeToolMeta(meta: ToolMeta): ToolMeta {
  const source = TOOL_METAS.find((tool) => tool.id === meta.id) ?? meta;
  return { ...source, title: translate(source.title), description: translate(source.description) };
}

export function localizeCategory(category: Category): Category {
  const source = categories.find((item) => item.id === category.id) ?? category;
  return { ...source, title: translate(source.title), description: translate(source.description) };
}

export function getToolMeta(id: string): ToolMeta {
  const meta = TOOL_METAS.find((t) => t.id === id);
  if (!meta) {
    return { id, slug: id, media: 'video', path: '/', title: id, description: '', icon: '🔧', category: 'video-utility', tags: [] };
  }
  return localizeToolMeta(meta);
}

export function toolsByMedia(media: Media): ToolMeta[] {
  return TOOL_METAS.filter((t) => t.media === media);
}

export function toolsByCategory(categoryId: CategoryId): ToolMeta[] {
  return TOOL_METAS.filter((t) => t.category === categoryId);
}

export function toolsByTag(tag: string): ToolMeta[] {
  return TOOL_METAS.filter((t) => t.tags.includes(tag));
}

export function allTags(): string[] {
  return [...new Set(TOOL_METAS.flatMap((t) => t.tags))].sort();
}
