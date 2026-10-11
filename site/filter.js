const MAX = 8;

function grayOf(image, width) {
  const height = Math.max(8, Math.round(image.height * (width / image.width)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  }
  return { gray, width, height };
}

function sharpness(sample) {
  const { gray, width, height } = sample;
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = gray[index - width] + gray[index + width] + gray[index - 1] + gray[index + 1] - 4 * gray[index];
      sum += value;
      sum2 += value * value;
      count += 1;
    }
  }
  const mean = sum / count;
  return sum2 / count - mean * mean;
}

function hashOf(sample) {
  const { gray, width, height } = sample;
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = gray[Math.min(height - 1, y) * width + Math.min(width - 1, x)];
      const right = gray[Math.min(height - 1, y) * width + Math.min(width - 1, x + 1)];
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits;
}

function distance(a, b) {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function load(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 读不了`));
    };
    image.src = url;
  });
}

async function compact(file) {
  const image = await load(file);
  const edge = Math.max(image.width, image.height);
  const scale = Math.min(1, 1280 / edge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  const sample = grayOf(image, 96);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    blob,
    sharp: sharpness(sample),
    hash: hashOf(sample),
  };
}

export async function choosePhotos(files) {
  const scored = [];
  const skipped = [];
  for (const file of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      skipped.push(file.name);
      continue;
    }
    try {
      scored.push(await compact(file));
    } catch {
      skipped.push(file.name);
    }
  }
  scored.sort((a, b) => b.sharp - a.sharp);
  const kept = [];
  for (const photo of scored) {
    if (kept.length >= MAX) break;
    if (photo.sharp < 25 && kept.length >= 2) continue;
    if (kept.some((item) => distance(item.hash, photo.hash) <= 6)) continue;
    kept.push(photo);
  }
  if (!kept.length && scored.length) kept.push(scored[0]);
  return { kept, dropped: files.length - kept.length, skipped };
}
