import { useCallback, useRef, useState } from 'react';
import { dragHasFiles, readDroppedItems, type FilterResult } from '../utils/readDroppedItems';

export interface FileDropHandlers {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function useFileDrop(onFiles: (result: FilterResult) => void): {
  isDragging: boolean;
  handlers: FileDropHandlers;
} {
  const [isDragging, setIsDragging] = useState(false);
  const counter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    counter.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    counter.current = Math.max(0, counter.current - 1);
    if (counter.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      counter.current = 0;
      setIsDragging(false);
      if (!dragHasFiles(e.dataTransfer)) return;
      void readDroppedItems(e.dataTransfer).then((result) => {
        onFiles(result);
      });
    },
    [onFiles],
  );

  return {
    isDragging,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
