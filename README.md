# Fiji Web — Thresholding, ROI & Measurement

A local-first browser app for interactive image thresholding, ROI drawing, and
intensity measurement, modelled on a Fiji measurement workflow. Built with
React + TypeScript + Vite + Zustand + Tailwind.

## Workflow

1. Upload one or more images.
2. Each image is converted to an 8-bit grayscale processing buffer
   (BT.601 luminance: `Y = 0.299 R + 0.587 G + 0.114 B`).
3. The right-hand panel always exposes three equal threshold presets. Pick one
   with the number keys (1 / 2 / 3) or by clicking. Adjusting the sliders edits
   the currently selected preset and saves automatically.
4. The live threshold overlay on the image reflects the active preset
   immediately — image and threshold sections are decoupled.
5. Draw an ROI (rectangle / ellipse / polygon / freehand) at any time.
6. Press **Enter** (or "Measure + Close + Next") to record the measurement and
   move to the next pending image.
7. Results appear in a sortable table and can be exported to CSV. All state is
   session-only and resets on page refresh — export to CSV to save results.

## Measurements

For the active image let `G` = grayscale 8-bit buffer, `T` = threshold mask,
`R` = rasterised ROI mask. Then:

- `roiAreaPx = count(R == 1)`
- `thresholdedAreaPx = count(R == 1 AND T == 1)`
- `integratedDensity = Σ G[i] where R[i] == 1 AND T[i] == 1`

Integrated density uses the 8-bit processing buffer — documented in
`src/domain/measurement/measure.ts`.

## Keyboard shortcuts

| Key | Action             |
|-----|--------------------|
| 1   | Select Preset 1    |
| 2   | Select Preset 2    |
| 3   | Select Preset 3    |
| R   | Rectangle tool     |
| E   | Ellipse tool       |
| P   | Polygon tool       |
| F   | Freehand tool      |
| S   | Skip active image  |
| T   | Toggle results window |
| Enter | Measure + next   |

Viewer: wheel to zoom, shift+drag to pan, double-click to close a polygon.

## Architecture

```
src/
  App.tsx                      layout shell
  components/                  UI (viewer, panels, wizard, table, toast)
  hooks/useHotkeys.ts          keyboard bindings
  domain/
    image/
      bufferTypes.ts           UploadedImage, GrayscaleBuffer
      decode.ts                file -> canvas -> gray buffer
      grayscale.ts             RGBA -> 8-bit gray
    threshold/
      thresholdTypes.ts        ThresholdRange / Source / clampRange
      thresholdEngine.ts       pure mask builder + count
      presets.ts               default preset values
    roi/
      roiTypes.ts              shape + mask types
      roiGeometry.ts           shape descriptors
      roiRasterize.ts          rect / ellipse / polygon scanline fill
    measurement/
      measurementTypes.ts      result row types
      measure.ts               single-pass measurement math
      csv.ts                   CSV export
    session/
      sessionTypes.ts          SessionState, SessionImage, Phase
      sessionStore.ts          Zustand store orchestrating the workflow
      uiTypes.ts               UI state types (theme, sidebar, results window)
  utils/                       ids, download helpers
  domain/__tests__/            Vitest unit + workflow tests
```

Domain code is pure TS with no React dependency, so it can be tested in
isolation and moved into a Web Worker if needed.

## Persistence

Everything is session-only. Uploads, thresholds, ROIs, calibrations, and
results live in memory and reset on page refresh. Use the CSV export to save
measurement results before reloading. The theme preference is the only value
that survives refresh (stored in `localStorage`).

## Development

```bash
npm install
npm run dev        # start Vite
npm run test       # run Vitest
npm run typecheck
npm run build
```

## Tradeoffs

- **No OpenCV.js**: the required operations (grayscale, thresholding,
  rasterisation, single-pass reduction) are small and straightforward; a
  pure-TS implementation avoids a multi-MB wasm download and keeps the
  measurement math testable. The `domain/` modules are structured so adding a
  worker later is a file move away.
- **No web workers in MVP**: thresholding and measurement are O(N) over the
  gray buffer and a fresh mask is built on-demand. With mask caching keyed to
  `(imageId, min, max)`, repeated reads are O(1). Promoting the threshold
  engine to a worker requires no API changes — it already exports a pure
  function.
- **Single ROI per image**: matches the MVP spec. Extending to multi-ROI only
  requires changing the `SessionImage.roi` field to an array and iterating in
  the viewer / measurement engine.
- **8-bit source of truth**: we measure against the 8-bit buffer to match the
  user's displayed preview. Preserving an original float intensity buffer
  would be a one-line addition to `SessionImage` and `measure`.
