export const UNDEVELOPED = "#3e3f3c";

function lin(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function unlin(channel) {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(255 * encoded);
}

function toOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function hexFromLinear(rgb) {
  return `#${rgb.map((channel) => unlin(channel).toString(16).padStart(2, "0")).join("")}`;
}

function muted([L, a, b]) {
  const chroma = Math.min(Math.hypot(a, b) * 0.6, 0.055);
  const hue = Math.atan2(b, a);
  return [
    Math.min(0.5, Math.max(0.36, 0.3 + 0.2 * L)),
    chroma * Math.cos(hue),
    chroma * Math.sin(hue),
  ];
}

export function labFromPixels(rgba) {
  if (!rgba?.length) return null;
  const sum = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    sum[0] += lin(rgba[index]);
    sum[1] += lin(rgba[index + 1]);
    sum[2] += lin(rgba[index + 2]);
    count += 1;
  }
  if (!count) return null;
  return toOklab(sum.map((value) => value / count));
}

export function roomHexFromLab(lab, { drawing = false } = {}) {
  if (!lab) return UNDEVELOPED;
  return hexFromLinear(fromOklab(drawing ? lab : muted(lab)));
}

export function roomHexFromPixels(rgba, options) {
  return roomHexFromLab(labFromPixels(rgba), options);
}

export function isLight(color) {
  const value = parseInt(String(color).slice(1), 16);
  if (!Number.isFinite(value)) return false;
  const lum = 0.2126 * lin(value >> 16) + 0.7152 * lin((value >> 8) & 255) + 0.0722 * lin(value & 255);
  return lum > 0.4;
}

export function onRoom(color) {
  return isLight(color) ? "#282923" : "#f2f0ea";
}

export function mixRooms(labs) {
  if (!labs?.length) return { trip: UNDEVELOPED, room: UNDEVELOPED };
  const mean = [0, 1, 2].map((channel) => labs.reduce((sum, lab) => sum + lab[channel], 0) / labs.length);
  return {
    trip: hexFromLinear(fromOklab(mean)),
    room: roomHexFromLab(mean),
  };
}

export function roomFromImage(image, { drawing = false } = {}) {
  const width = 64;
  const ratio = image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
  const height = Math.max(8, Math.round(ratio * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const rows = Math.max(1, Math.round(height * 0.08));
  return roomHexFromPixels(context.getImageData(0, 0, width, rows).data, { drawing });
}

export async function labFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const width = 64;
    const height = Math.max(8, Math.round((bitmap.height / bitmap.width) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const rows = Math.max(1, Math.round(height * 0.08));
    return labFromPixels(context.getImageData(0, 0, width, rows).data);
  } finally {
    bitmap.close?.();
  }
}
