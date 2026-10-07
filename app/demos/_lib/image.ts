// Browser-side image loading shared by the texture demonstrations.
// Images are centre-cropped to a square before resizing, so that frequencies, orientations and
// displacement vectors are not distorted by unequal horizontal and vertical scaling.

export type SquareImage = {
  /** RGBA bytes of the size × size analysis image (sRGB-encoded, as decoded by the browser). */
  rgba: Uint8ClampedArray;
  size: number;
  /** Side of the centred square taken from the source, in source pixels. */
  cropSide: number;
  sourceWidth: number;
  sourceHeight: number;
};

export function loadSquareImage(source: string, size: number): Promise<SquareImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("2D canvas unavailable"));
        return;
      }
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.imageSmoothingQuality = "high";
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      resolve({ rgba: context.getImageData(0, 0, size, size).data, size, cropSide: side, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight });
    };
    image.onerror = () => reject(new Error(`Could not decode ${source}`));
    image.src = source;
  });
}

/** Luma with Rec. 709 weights applied to the encoded (non-linear) R′G′B′ values, range 0–255. */
export function lumaOf(rgba: Uint8ClampedArray) {
  const values = new Float64Array(rgba.length / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = 0.2126 * rgba[index * 4] + 0.7152 * rgba[index * 4 + 1] + 0.0722 * rgba[index * 4 + 2];
  }
  return values;
}

export function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode ${source}`));
    image.src = source;
  });
}

/**
 * Renders a size × size view of the centred square of `image`, rotated clockwise on screen by
 * `degrees` and magnified by `zoom`. The view always shows a region of side s/(√2·zoom), where s is the
 * square's side, so that any rotation fits inside the source and the scale does not depend on the angle.
 */
export function renderView(image: HTMLImageElement, size: number, zoom: number, degrees: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const region = side / (Math.SQRT2 * zoom);
  const scale = size / region;
  context.imageSmoothingQuality = "high";
  context.translate(size / 2, size / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, (-side * scale) / 2, (-side * scale) / 2, side * scale, side * scale);
  return { rgba: context.getImageData(0, 0, size, size).data, region };
}

/** Human-readable description of the crop applied to the source. */
export function cropDescription(image: SquareImage) {
  const cropped = image.sourceWidth !== image.sourceHeight;
  return `${image.sourceWidth}×${image.sourceHeight} source${cropped ? `, centre ${image.cropSide}×${image.cropSide} crop` : ""}, resized to ${image.size}×${image.size}`;
}
