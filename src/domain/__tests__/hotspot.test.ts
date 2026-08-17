import { describe, it, expect } from 'vitest';
import { detectHotspot } from '../image/hotspotDetect';

describe('detectHotspot', () => {
  it('returns null for an empty image', () => {
    expect(detectHotspot(new Uint8Array(0), 0, 0)).toBeNull();
  });

  it('returns null for a uniform dark image', () => {
    const w = 256;
    const h = 256;
    const data = new Uint8Array(w * h).fill(10);
    expect(detectHotspot(data, w, h)).toBeNull();
  });

  it('returns null for a uniform bright image', () => {
    const w = 256;
    const h = 256;
    const data = new Uint8Array(w * h).fill(200);
    expect(detectHotspot(data, w, h)).toBeNull();
  });

  it('returns null when bright region covers more than 40% of image', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h).fill(10);
    // Fill a 70x70 area (49% of the image) with bright pixels
    for (let y = 0; y < 70; y++) {
      for (let x = 0; x < 70; x++) {
        data[y * w + x] = 255;
      }
    }
    expect(detectHotspot(data, w, h)).toBeNull();
  });

  it('detects a single bright spot in a dark field', () => {
    const w = 512;
    const h = 512;
    const data = new Uint8Array(w * h).fill(5);
    // Place a 48x48 bright patch at (200, 200)
    for (let y = 200; y < 248; y++) {
      for (let x = 200; x < 248; x++) {
        data[y * w + x] = 240;
      }
    }
    const result = detectHotspot(data, w, h);
    expect(result).not.toBeNull();
    // The hotspot center should be near (224, 224) - the center of the bright patch
    const cx = result!.x + result!.width / 2;
    const cy = result!.y + result!.height / 2;
    expect(cx).toBeGreaterThan(200);
    expect(cx).toBeLessThan(260);
    expect(cy).toBeGreaterThan(200);
    expect(cy).toBeLessThan(260);
  });

  it('selects the brightest cluster when multiple exist', () => {
    const w = 512;
    const h = 512;
    const data = new Uint8Array(w * h).fill(5);
    // Smaller but dimmer cluster at top-left
    for (let y = 10; y < 42; y++) {
      for (let x = 10; x < 42; x++) {
        data[y * w + x] = 150;
      }
    }
    // Larger and brighter cluster at bottom-right
    for (let y = 400; y < 464; y++) {
      for (let x = 400; x < 464; x++) {
        data[y * w + x] = 255;
      }
    }
    const result = detectHotspot(data, w, h);
    expect(result).not.toBeNull();
    const cx = result!.x + result!.width / 2;
    const cy = result!.y + result!.height / 2;
    // Should center on the brighter cluster (around 432, 432)
    expect(cx).toBeGreaterThan(380);
    expect(cy).toBeGreaterThan(380);
  });

  it('clamps bounding box to image bounds for corner hotspot', () => {
    const w = 256;
    const h = 256;
    const data = new Uint8Array(w * h).fill(5);
    // Bright patch in top-left corner
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        data[y * w + x] = 250;
      }
    }
    const result = detectHotspot(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(0);
    expect(result!.y).toBeGreaterThanOrEqual(0);
    expect(result!.x + result!.width).toBeLessThanOrEqual(w);
    expect(result!.y + result!.height).toBeLessThanOrEqual(h);
  });
});
