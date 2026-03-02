declare global {
  interface Window {
    Tesseract?: {
      recognize: (
        image: File | Blob | string,
        lang?: string,
        options?: { logger?: (data: any) => void; [key: string]: any },
      ) => Promise<{ data?: { text?: string } }>;
    };
  }
}

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let loadingPromise: Promise<void> | null = null;

const ensureTesseract = async () => {
  if (window.Tesseract) return;
  if (!loadingPromise) {
    loadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TESSERACT_CDN;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar Tesseract desde CDN.'));
      document.head.appendChild(script);
    });
  }

  await loadingPromise;

  if (!window.Tesseract) {
    throw new Error('Tesseract no quedó disponible en window.');
  }
};

const fileToImage = async (file: File): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo leer la imagen para OCR.'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('No se pudo convertir la imagen procesada.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
};

const buildEnhancedOcrImage = async (file: File): Promise<Blob> => {
  const img = await fileToImage(file);

  // Escalamos para mejorar lectura de números pequeños y aplicamos alto contraste.
  const scale = 2;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar canvas OCR.');

  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Grises + contraste fuerte para texto.
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const contrast = gray > 150 ? 255 : gray < 90 ? 0 : gray;
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};

const buildFocusedCenterCrop = async (file: File): Promise<Blob> => {
  const img = await fileToImage(file);

  // Región donde suele aparecer el monto principal en screenshots mobile de PlanVital.
  const cropX = Math.floor(img.width * 0.12);
  const cropY = Math.floor(img.height * 0.24);
  const cropW = Math.floor(img.width * 0.78);
  const cropH = Math.floor(img.height * 0.34);

  const scale = 2.6;
  const outW = Math.max(1, Math.floor(cropW * scale));
  const outH = Math.max(1, Math.floor(cropH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar crop OCR.');

  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  const imageData = ctx.getImageData(0, 0, outW, outH);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = gray > 165 ? 255 : gray < 80 ? 0 : gray;
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
};

const scoreOcrText = (text: string): number => {
  const lower = text.toLowerCase();
  const digitCount = (text.match(/[0-9]/g) || []).length;
  const hasPlanvitalMarker = /total\s+ahorrad[oó]\s+actual/i.test(text) ? 40 : 0;
  const hasLongAmount = /[0-9][0-9.,\s]{6,}/.test(text) ? 30 : 0;
  const hasCurrency = lower.includes('$') ? 10 : 0;
  return digitCount + hasPlanvitalMarker + hasLongAmount + hasCurrency;
};

export const runOcrFromFile = async (
  file: File,
  onProgress?: (pct: number, status: string) => void,
): Promise<string> => {
  const mime = file.type || '';
  if (mime.includes('pdf')) {
    throw new Error('Para PDF, sube una captura de pantalla de la página que quieres leer.');
  }

  await ensureTesseract();

  const resultOriginal = await window.Tesseract!.recognize(file, 'spa+eng', {
    logger: (entry: any) => {
      const pct = Math.round((Number(entry?.progress || 0) || 0) * 100);
      onProgress?.(pct, String(entry?.status || 'processing'));
    },
  });

  let enhancedText = '';
  let focusedText = '';
  try {
    onProgress?.(5, 'enhancing_image');
    const enhanced = await buildEnhancedOcrImage(file);
    const resultEnhanced = await window.Tesseract!.recognize(enhanced, 'spa+eng');
    enhancedText = String(resultEnhanced?.data?.text || '').trim();
  } catch {
    // Si falla el preprocesado, seguimos con OCR original.
  }

  try {
    onProgress?.(8, 'focused_crop');
    const focused = await buildFocusedCenterCrop(file);
    const resultFocused = await window.Tesseract!.recognize(focused, 'spa+eng', {
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: '0123456789$., TotalahorradoactualTOTALAHORRADOACTUAL',
    });
    focusedText = String(resultFocused?.data?.text || '').trim();
  } catch {
    // Si falla crop, no bloqueamos.
  }

  const originalText = String(resultOriginal?.data?.text || '').trim();
  const bestPrimary = scoreOcrText(enhancedText) > scoreOcrText(originalText) ? enhancedText : originalText;

  // Devolvemos texto combinado para que parsers puedan capturar montos que salieron solo en el crop.
  const merged = [bestPrimary, focusedText].filter(Boolean).join('\n');
  return merged || bestPrimary;
};
