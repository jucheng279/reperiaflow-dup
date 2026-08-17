/// <reference lib="webworker" />
import {
  applyTiffStretch,
  applyTiffStretchFixed,
  decodeTiffBuffer,
  type TiffPage,
  type TiffStretchContext,
  type TiffStretchMode,
  type TiffStretchResult,
} from '../domain/image/tiff';

interface DecodeRequest {
  type: 'decode';
  reqId: number;
  buffer: ArrayBuffer;
  stretchMode?: TiffStretchMode;
}

interface StretchRequest {
  type: 'stretch';
  reqId: number;
  ctx: TiffStretchContext;
  mode: TiffStretchMode;
}

interface StretchFixedRequest {
  type: 'stretchFixed';
  reqId: number;
  ctx: TiffStretchContext;
  lo: number;
  hi: number;
}

type WorkerRequest = DecodeRequest | StretchRequest | StretchFixedRequest;

interface DecodeResponse {
  type: 'decoded';
  reqId: number;
  pages: TiffPage[];
}

interface StretchResponse {
  type: 'stretched';
  reqId: number;
  result: TiffStretchResult;
}

interface ErrorResponse {
  type: 'error';
  reqId: number;
  message: string;
}

export type WorkerResponse = DecodeResponse | StretchResponse | ErrorResponse;

function collectTransfers(pages: TiffPage[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const transfers: Transferable[] = [];
  const add = (buf: ArrayBufferLike | undefined) => {
    if (!buf) return;
    const ab = buf as ArrayBuffer;
    if (seen.has(ab)) return;
    seen.add(ab);
    transfers.push(ab);
  };
  for (const page of pages) {
    if (page.gray) add(page.gray.buffer);
    if (page.rgba) add(page.rgba.buffer);
    if (page.stretchContext) add(page.stretchContext.raw.buffer);
  }
  return transfers;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const post = (resp: WorkerResponse, transfers: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(resp, transfers);

  try {
    if (msg.type === 'decode') {
      const pages = await decodeTiffBuffer(msg.buffer, msg.stretchMode);
      post({ type: 'decoded', reqId: msg.reqId, pages }, collectTransfers(pages));
    } else if (msg.type === 'stretch') {
      const result = applyTiffStretch(msg.ctx, msg.mode);
      post({ type: 'stretched', reqId: msg.reqId, result }, [result.gray.buffer]);
    } else if (msg.type === 'stretchFixed') {
      const result = applyTiffStretchFixed(msg.ctx, msg.lo, msg.hi);
      post({ type: 'stretched', reqId: msg.reqId, result }, [result.gray.buffer]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', reqId: msg.reqId, message });
  }
};

export type {
  DecodeRequest,
  StretchRequest,
  StretchFixedRequest,
  DecodeResponse,
  StretchResponse,
  ErrorResponse,
};
