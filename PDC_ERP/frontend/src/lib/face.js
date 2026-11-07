// Browser-side face detection + matching using @vladmandic/face-api (128-d face descriptors).
// The library (~1.5 MB) and the three models in /public/models (~12 MB) are only fetched when this is first used.
//
// A descriptor distance below ~0.6 is the library's standard "same person" threshold. Government ID photos are
// small and low quality, so treat a miss as "needs a human look", never as proof of fraud.
export const MATCH_THRESHOLD = 0.6;

let loading = null;

export function loadFaceModels() {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      return faceapi;
    })().catch((e) => {
      loading = null; // allow a retry
      throw e;
    });
  }
  return loading;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

function crop(img, fx, fy, fw, fh) {
  const c = document.createElement('canvas');
  const sx = img.width * fx;
  const sy = img.height * fy;
  const sw = img.width * fw;
  const sh = img.height * fh;
  const scale = Math.min(2, 1024 / Math.max(sw, sh)); // upscale small crops so a small ID photo gets enough pixels
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

async function detectIn(faceapi, input) {
  const all = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return all;
}

// Returns { count, descriptor } for the most prominent face. An ID card is a big image with a small portrait,
// so if the whole frame yields nothing we retry on zoomed-in regions of the card.
export async function faceFromImage(src, { tiles = false } = {}) {
  const faceapi = await loadFaceModels();
  const img = await loadImage(src);
  let faces = await detectIn(faceapi, img);
  if (!faces.length && tiles) {
    const regions = [
      [0, 0, 0.5, 1],
      [0, 0.2, 0.5, 0.8],
      [0, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0, 0.5, 1],
      [0.25, 0.1, 0.5, 0.8],
    ];
    for (const r of regions) {
      faces = await detectIn(faceapi, crop(img, ...r));
      if (faces.length) break;
    }
  }
  if (!faces.length) return { count: 0, descriptor: null };
  const best = faces.reduce((a, b) => (b.detection.box.area * b.detection.score > a.detection.box.area * a.detection.score ? b : a));
  return { count: faces.length, descriptor: best.descriptor };
}

// status: 'ok' | 'no_id_face' | 'no_selfie_face' | 'multiple_selfie_faces'
export async function compareFaces(idSrc, selfieSrc) {
  const faceapi = await loadFaceModels();
  const selfie = await faceFromImage(selfieSrc);
  if (!selfie.count) return { status: 'no_selfie_face' };
  if (selfie.count > 1) return { status: 'multiple_selfie_faces' };
  const id = await faceFromImage(idSrc, { tiles: true });
  if (!id.count) return { status: 'no_id_face' };
  const distance = faceapi.euclideanDistance(id.descriptor, selfie.descriptor);
  return { status: 'ok', distance, match: distance < MATCH_THRESHOLD };
}
