export type ThemeMode = 'light' | 'dark';

export type SidebarDisplayMode = 'compact' | 'preview';

export type PreviewSortMode = 'queue' | 'intensity';

export type ResultsViewMode = 'batched' | 'flat';

export interface ResultsWindowState {
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}
