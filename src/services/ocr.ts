declare global {
  interface Window {
    Tesseract?: {
      recognize: (
        image: File | Blob | string,
        lang?: string,
        options?: { logger?: (data: any) => void },
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

export const runOcrFromFile = async (
  file: File,
  onProgress?: (pct: number, status: string) => void,
): Promise<string> => {
  const mime = file.type || '';
  if (mime.includes('pdf')) {
    throw new Error('Para PDF, sube una captura de pantalla de la página que quieres leer.');
  }

  await ensureTesseract();

  const result = await window.Tesseract!.recognize(file, 'spa+eng', {
    logger: (entry: any) => {
      const pct = Math.round((Number(entry?.progress || 0) || 0) * 100);
      onProgress?.(pct, String(entry?.status || 'processing'));
    },
  });

  return String(result?.data?.text || '').trim();
};
