// Traitement des images dans le téléphone (remplace Sharp côté serveur), mêmes résultats :
// photo -> JPEG redressé (EXIF) ≤ 2400 px + vignette WebP ≤ 640 px ; dessin -> PNG transparent.
import { HttpError, MAX_SIDE, THUMB_SIDE } from '../../../server/src/core/journal.js';

async function decode(bytes) {
  try {
    // imageOrientation 'from-image' : la rotation EXIF est appliquée (comme sharp.rotate()).
    return await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  } catch {
    throw new HttpError(415, "Ce fichier n'est pas une image lisible");
  }
}

const fit = (w, h, max, enlarge = false) => {
  const k = Math.min(max / w, max / h, enlarge ? Infinity : 1);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};

async function encode(source, width, height, type, quality) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error(`Format ${type} non pris en charge par ce navigateur`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), canvas };
}

export const images = {
  async photo(bytes) {
    const bitmap = await decode(bytes);
    const [w, h] = fit(bitmap.width, bitmap.height, MAX_SIDE);
    const main = await encode(bitmap, w, h, 'image/jpeg', 0.88);
    bitmap.close();
    const [tw, th] = fit(w, h, THUMB_SIDE, true);
    const thumb = await encode(main.canvas, tw, th, 'image/webp', 0.8);
    return { main: main.bytes, thumb: thumb.bytes, width: w, height: h };
  },
  async drawing(bytes, withThumb) {
    const bitmap = await decode(bytes);
    const [w, h] = fit(bitmap.width, bitmap.height, MAX_SIDE);
    const main = await encode(bitmap, w, h, 'image/png');
    bitmap.close();
    let thumb = null;
    if (withThumb) {
      const [tw, th] = fit(w, h, THUMB_SIDE, true);
      thumb = (await encode(main.canvas, tw, th, 'image/webp', 0.85)).bytes;
    }
    return { main: main.bytes, thumb, width: w, height: h };
  },
};
