import type { RoiShape } from './roiTypes';

export function describeRoi(roi: RoiShape): string {
  switch (roi.type) {
    case 'rectangle':
      return `rect ${roi.w|0}x${roi.h|0}`;
    case 'ellipse':
      return `ellipse ${roi.w|0}x${roi.h|0}`;
    case 'polygon':
      return `polygon (${roi.points.length} pts)`;
    case 'freehand':
      return `freehand (${roi.points.length} pts)`;
    case 'line':
      return 'line';
    case 'freehandLine':
      return `freehand line (${roi.points.length} pts)`;
    case 'point':
      return `points (${roi.points.length})`;
    case 'pointArrow':
      return `points (${roi.points.length})`;
  }
}
