export interface UploadedImage {
  id: string;
  fileName: string;
  width: number;
  height: number;
  originalFile: File;
}

export interface GrayscaleBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RgbaBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
