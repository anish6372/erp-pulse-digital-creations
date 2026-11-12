// Image helpers for onboarding: phone photos are 4-12 MB, so everything is downscaled to JPEG before upload.

function drawToJpeg(source, w, h, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export async function fileToJpegDataUrl(file, maxSide = 1600, quality = 0.85) {
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large. Please choose one under 25 MB.');
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    try {
      bmp = await createImageBitmap(file);
    } catch (e2) {
      throw new Error('Could not read that image. Please use a JPG or PNG photo.');
    }
  }
  const out = drawToJpeg(bmp, bmp.width, bmp.height, maxSide, quality);
  if (bmp.close) bmp.close();
  return out;
}

export function videoFrameToJpeg(video, maxSide = 1280, quality = 0.9) {
  return drawToJpeg(video, video.videoWidth, video.videoHeight, maxSide, quality);
}
