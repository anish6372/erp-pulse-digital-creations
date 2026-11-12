'use client';
import { icon, icons } from '../legacy/lib/icons.js';

// The app's icons are SVG strings; render them as inline markup.
export default function Icon({ name, raw }) {
  const html = raw ? icons[raw] : icon(name);
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html || '' }} />;
}
