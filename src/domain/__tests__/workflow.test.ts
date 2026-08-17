import { describe, it, expect, beforeEach, vi } from 'vitest';

// Avoid browser-only decode path.
vi.mock('../image/decode', () => ({
  decodeFileToGray: vi.fn(),
  decodeFileToPages: vi.fn().mockResolvedValue([]),
  grayToImageData: vi.fn(),
}));

import { useSessionStore } from '../session/sessionStore';
import type { SessionImage } from '../session/sessionTypes';
import { defaultThreshold } from '../threshold/presets';

function makeImage(name: string, w = 4, h = 4, fill = 200): SessionImage {
  const rgbaData = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    rgbaData[p] = fill;
    rgbaData[p + 1] = fill;
    rgbaData[p + 2] = fill;
    rgbaData[p + 3] = 255;
  }
  return {
    id: `img-${name}`,
    fileName: name,
    width: w,
    height: h,
    gray: { width: w, height: h, data: new Uint8Array(w * h).fill(fill) },
    rgba: { width: w, height: h, data: rgbaData },
    status: 'pending',
    rois: [],
    selectedRoiIndex: -1,
    calibration: { pixelWidth: 1, pixelHeight: 1, unit: 'px', source: 'none' },
    grayscaleMode: 'average',
    grayscaleModeUserSet: false,
  };
}

describe('session workflow', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessionId: 'test',
      phase: 'empty',
      images: [],
      activeIndex: -1,
      threshold: defaultThreshold(),
      rows: [],
      error: null,
      overlayOpacity: 0.5,
      activeTool: 'rectangle',
    });
  });

  it('updateThreshold mutates the active threshold range', () => {
    useSessionStore.setState({
      images: [makeImage('a')],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().updateThreshold({ min: 50, max: 200 });
    const st = useSessionStore.getState();
    expect(st.threshold).toEqual({ min: 50, max: 200 });
  });

  it('measure + close + next reads the current threshold', () => {
    useSessionStore.setState({
      images: [makeImage('a'), makeImage('b')],
      activeIndex: 0,
      phase: 'working',
    });
    const s = useSessionStore.getState();
    s.updateThreshold({ min: 100, max: 210 });
    s.addRoi({ type: 'rectangle', x: 0, y: 0, w: 4, h: 4 });
    return s.measureAndNext().then(() => {
      const st = useSessionStore.getState();
      expect(st.images[0].status).toBe('measured');
      expect(st.rows.length).toBe(1);
      expect(st.rows[0].thresholdSource).toBe('threshold');
      expect(st.rows[0].thresholdMin).toBe(100);
      expect(st.rows[0].thresholdMax).toBe(210);
      expect(st.activeIndex).toBe(1);
    });
  });

  it('measuring without ROI falls back to full-image area in fluorescence mode', async () => {
    useSessionStore.setState({
      images: [makeImage('a')],
      activeIndex: 0,
      phase: 'working',
    });
    await useSessionStore.getState().measureAndNext();
    const st = useSessionStore.getState();
    expect(st.rows.length).toBe(1);
    expect(st.rows[0].roiType).toBe('full');
  });

  it('skipping marks image as skipped and advances', () => {
    useSessionStore.setState({
      images: [makeImage('a'), makeImage('b')],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().skipActive();
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('skipped');
    expect(st.activeIndex).toBe(1);
  });

  it('unskipActive flips a skipped image back to pending', () => {
    useSessionStore.setState({
      images: [{ ...makeImage('a'), status: 'skipped' }, makeImage('b')],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().unskipActive();
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
  });

  it('unskipActive is a no-op for non-skipped images', () => {
    useSessionStore.setState({
      images: [makeImage('a')],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().unskipActive();
    expect(useSessionStore.getState().images[0].status).toBe('pending');
  });

  it('unskipByKeywords restores only matching skipped images and returns count', () => {
    useSessionStore.setState({
      images: [
        { ...makeImage('alpha-txr.tif'), status: 'skipped' },
        { ...makeImage('beta-dapi.tif'), status: 'skipped' },
        { ...makeImage('gamma.tif'), status: 'skipped' },
        makeImage('delta-txr.tif'),
      ],
      activeIndex: 0,
      phase: 'working',
    });
    const count = useSessionStore.getState().unskipByKeywords('txr, dapi');
    expect(count).toBe(2);
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
    expect(st.images[1].status).toBe('pending');
    expect(st.images[2].status).toBe('skipped');
    expect(st.images[3].status).toBe('pending');
  });

  it('skip then unskip round-trip restores image to pending', () => {
    useSessionStore.setState({
      images: [makeImage('a-txr.tif'), makeImage('b.tif')],
      activeIndex: 0,
      phase: 'working',
    });
    const skipped = useSessionStore.getState().skipByKeywords('txr');
    expect(skipped).toBe(1);
    expect(useSessionStore.getState().images[0].status).toBe('skipped');
    const restored = useSessionStore.getState().unskipByKeywords('txr');
    expect(restored).toBe(1);
    expect(useSessionStore.getState().images[0].status).toBe('pending');
  });

  it('removing the active image snapshots threshold onto the newly active image', () => {
    const imgA = makeImage('a');
    const imgB = makeImage('b');
    useSessionStore.setState({
      images: [imgA, imgB],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().updateThreshold({ min: 40, max: 180 });
    useSessionStore.getState().removeImage(imgA.id);
    const st = useSessionStore.getState();
    expect(st.activeIndex).toBe(0);
    expect(st.images[0].id).toBe(imgB.id);
    expect(st.images[0].lastViewedThreshold).toEqual({ min: 40, max: 180 });
  });

  it('removing a non-active image leaves active threshold snapshot untouched', () => {
    const imgA = makeImage('a');
    const imgB = makeImage('b');
    useSessionStore.setState({
      images: [imgA, imgB],
      activeIndex: 0,
      phase: 'working',
    });
    useSessionStore.getState().updateThreshold({ min: 10, max: 90 });
    const before = useSessionStore.getState().images[0].lastViewedThreshold;
    useSessionStore.getState().removeImage(imgB.id);
    const st = useSessionStore.getState();
    expect(st.activeIndex).toBe(0);
    expect(st.images[0].id).toBe(imgA.id);
    expect(st.images[0].lastViewedThreshold).toEqual(before);
  });

  it('done phase when queue is exhausted', () => {
    useSessionStore.setState({
      images: [makeImage('a')],
      activeIndex: 0,
      phase: 'working',
    });
    const s = useSessionStore.getState();
    s.addRoi({ type: 'rectangle', x: 0, y: 0, w: 2, h: 2 });
    return s.measureAndNext().then(() => {
      expect(useSessionStore.getState().phase).toBe('done');
    });
  });

  it('unskipSecondarySelected restores skipped images to pending', () => {
    useSessionStore.setState({
      images: [
        { ...makeImage('a'), status: 'skipped' },
        { ...makeImage('b'), status: 'skipped' },
        makeImage('c'),
      ],
      activeIndex: 2,
      phase: 'done',
      secondarySelectedIds: ['img-a', 'img-c'],
    });
    useSessionStore.getState().unskipSecondarySelected();
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
    expect(st.images[1].status).toBe('skipped');
    expect(st.images[2].status).toBe('pending');
    expect(st.secondarySelectedIds).toEqual([]);
    expect(st.phase).toBe('working');
  });

  it('unskipAfterLastSelected restores skipped images after the last selected', () => {
    useSessionStore.setState({
      images: [
        { ...makeImage('a'), status: 'skipped' },
        { ...makeImage('b'), status: 'skipped' },
        { ...makeImage('c'), status: 'skipped' },
        makeImage('d'),
      ],
      activeIndex: 3,
      phase: 'done',
      secondarySelectedIds: ['img-b'],
    });
    useSessionStore.getState().unskipAfterLastSelected(['img-a', 'img-b', 'img-c', 'img-d']);
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('skipped');
    expect(st.images[1].status).toBe('skipped');
    expect(st.images[2].status).toBe('pending');
    expect(st.images[3].status).toBe('pending');
    expect(st.secondarySelectedIds).toEqual([]);
    expect(st.phase).toBe('working');
  });

  it('unskipBeforeFirstSelected restores skipped images before the first selected', () => {
    useSessionStore.setState({
      images: [
        { ...makeImage('a'), status: 'skipped' },
        { ...makeImage('b'), status: 'skipped' },
        { ...makeImage('c'), status: 'skipped' },
        makeImage('d'),
      ],
      activeIndex: 3,
      phase: 'done',
      secondarySelectedIds: ['img-c'],
    });
    useSessionStore.getState().unskipBeforeFirstSelected(['img-a', 'img-b', 'img-c', 'img-d']);
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
    expect(st.images[1].status).toBe('pending');
    expect(st.images[2].status).toBe('skipped');
    expect(st.images[3].status).toBe('pending');
    expect(st.secondarySelectedIds).toEqual([]);
    expect(st.phase).toBe('working');
  });

  it('unskipAllExceptSelected restores all skipped except selected', () => {
    useSessionStore.setState({
      images: [
        { ...makeImage('a'), status: 'skipped' },
        { ...makeImage('b'), status: 'skipped' },
        { ...makeImage('c'), status: 'skipped' },
      ],
      activeIndex: 0,
      phase: 'done',
      secondarySelectedIds: ['img-b'],
    });
    useSessionStore.getState().unskipAllExceptSelected();
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
    expect(st.images[1].status).toBe('skipped');
    expect(st.images[2].status).toBe('pending');
    expect(st.secondarySelectedIds).toEqual([]);
    expect(st.phase).toBe('working');
  });

  it('unskip operations do not affect non-skipped images', () => {
    useSessionStore.setState({
      images: [
        makeImage('a'),
        { ...makeImage('b'), status: 'measured' },
      ],
      activeIndex: 0,
      phase: 'working',
      secondarySelectedIds: ['img-a', 'img-b'],
    });
    useSessionStore.getState().unskipSecondarySelected();
    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('pending');
    expect(st.images[1].status).toBe('measured');
  });
});
