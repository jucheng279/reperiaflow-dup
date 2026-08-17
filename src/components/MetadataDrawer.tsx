import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clipboard,
  Database,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  Microscope,
  Ruler,
  Tags,
  X,
} from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { isCalibrated } from '../domain/image/calibration';
import type { SessionImage } from '../domain/session/sessionTypes';
import type {
  OmeChannelInfo,
  RawTiffTag,
  TiffMetadata,
} from '../domain/image/tiff';

export function MetadataDrawer() {
  const open = useSessionStore((s) => s.metadataPanel.open);
  const imageId = useSessionStore((s) => s.metadataPanel.imageId);
  const close = useSessionStore((s) => s.closeMetadataPanel);
  const image = useSessionStore((s) =>
    imageId ? s.images.find((i) => i.id === imageId) ?? null : null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={close}
        className={`fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-[2px] transition-opacity duration-200 dark:bg-slate-950/60 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        role="dialog"
        aria-label="Image metadata"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-[28rem] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-slate-800 dark:bg-slate-950 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {image ? (
          <DrawerBody image={image} onClose={close} />
        ) : (
          <EmptyDrawer onClose={close} />
        )}
      </aside>
    </>
  );
}

function EmptyDrawer({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DrawerHeader title="Image info" subtitle="No image selected" onClose={onClose} />
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500 dark:text-slate-400">
        Select an image to inspect its metadata.
      </div>
    </>
  );
}

function DrawerBody({ image, onClose }: { image: SessionImage; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const meta = image.tiffMetadata;
  const fileMeta = image.fileMetadata;

  const handleCopy = async () => {
    const payload = {
      fileName: image.fileName,
      width: image.width,
      height: image.height,
      file: fileMeta,
      tiff: meta,
      tiffSource: image.tiffSource,
      calibration: image.calibration,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <DrawerHeader
        title={image.fileName}
        subtitle={`${image.width.toLocaleString()} x ${image.height.toLocaleString()} px`}
        onClose={onClose}
      />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <FileSection image={image} />
        <PixelsSection image={image} />
        <CalibrationSection image={image} />
        {meta?.imagej && <ImageJSection meta={meta} />}
        {meta?.ome && <OmeSection meta={meta} />}
        {meta && <CaptureSection meta={meta} />}
        {meta?.imageDescription && (
          <CollapsibleSection
            title="Description (raw)"
            icon={<FileText size={14} />}
            defaultOpen={false}
          >
            <RawDescription text={meta.imageDescription} kind={meta.descriptionKind} />
          </CollapsibleSection>
        )}
        {meta && meta.rawTags.length > 0 && (
          <CollapsibleSection title="All TIFF tags" icon={<Tags size={14} />} defaultOpen={false}>
            <RawTagTable tags={meta.rawTags} />
          </CollapsibleSection>
        )}
        {!meta && (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            This image format does not include rich metadata. Channel identity must
            be inferred from the filename or recorded manually.
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/80">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Press{' '}
          <kbd className="rounded border border-slate-300 bg-white px-1 text-[10px] font-mono dark:border-slate-700 dark:bg-slate-800">
            i
          </kbd>{' '}
          to toggle
        </span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-400 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500 dark:hover:text-cyan-200"
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
      </div>
    </>
  );
}

function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Info size={12} />
          Image info
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
        )}
      </div>
      <button
        onClick={onClose}
        aria-label="Close metadata panel"
        className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="shrink-0 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:text-slate-300">
        {icon}
        {title}
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <section className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
      >
        <ChevronRight
          size={14}
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {icon}
        {title}
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-right text-slate-800 dark:text-slate-200">
        {value ?? '-'}
      </span>
    </div>
  );
}

function FileSection({ image }: { image: SessionImage }) {
  const fm = image.fileMetadata;
  return (
    <Section title="File" icon={<ImageIcon size={14} />}>
      <Row label="Name" value={image.fileName} />
      <Row label="Size" value={fm ? formatBytes(fm.sizeBytes) : '-'} />
      <Row label="Type" value={fm?.mimeType || '-'} />
      <Row
        label="Modified"
        value={fm ? new Date(fm.lastModified).toLocaleString() : '-'}
      />
    </Section>
  );
}

function PixelsSection({ image }: { image: SessionImage }) {
  const src = image.tiffSource;
  const meta = image.tiffMetadata;
  const fm = image.fileMetadata;
  return (
    <Section title="Pixels" icon={<Database size={14} />}>
      <Row
        label="Dimensions"
        value={`${image.width.toLocaleString()} x ${image.height.toLocaleString()}`}
      />
      {meta && <Row label="Sample format" value={meta.sampleFormatLabel} />}
      {!meta && fm?.bitDepth != null && (
        <Row
          label="Sample format"
          value={`${fm.bitDepth}-bit${fm.channels ? ` x ${fm.channels}ch` : ''}`}
        />
      )}
      {meta && <Row label="Compression" value={meta.compressionLabel} />}
      {meta && (
        <Row
          label="Photometric"
          value={`${meta.photometricLabel} (${meta.photometric})`}
        />
      )}
      {src && (
        <>
          <Row label="Samples / pixel" value={src.samplesPerPixel} />
          <Row
            label="Native range"
            value={
              src.nativeMin != null && src.nativeMax != null
                ? `${formatNumber(src.nativeMin)} ... ${formatNumber(src.nativeMax)}`
                : '-'
            }
          />
          <Row
            label="Display range"
            value={
              src.displayMin != null && src.displayMax != null
                ? `${formatNumber(src.displayMin)} ... ${formatNumber(src.displayMax)}`
                : '-'
            }
          />
          <Row label="Stretch" value={src.stretchMethod} />
        </>
      )}
    </Section>
  );
}

function CalibrationSection({ image }: { image: SessionImage }) {
  const cal = image.calibration;
  const ps = image.tiffMetadata?.pixelSize;
  return (
    <Section title="Calibration" icon={<Ruler size={14} />}>
      <Row label="Source" value={<SourceBadge source={cal.source} />} />
      {isCalibrated(cal) ? (
        <Row
          label="Pixel size"
          value={`${formatNumber(cal.pixelWidth)} x ${formatNumber(cal.pixelHeight)} ${cal.unit}`}
        />
      ) : (
        <Row label="Pixel size" value="Uncalibrated" />
      )}
      {ps && (
        <Row
          label="From metadata"
          value={`${formatNumber(ps.x)} x ${formatNumber(ps.y)} ${ps.unit} (${ps.source})`}
        />
      )}
    </Section>
  );
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    none: {
      label: 'Uncalibrated',
      cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    },
    'set-scale': {
      label: 'Manual line',
      cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200',
    },
    manual: {
      label: 'Manual',
      cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200',
    },
    'tiff-metadata': {
      label: 'TIFF metadata',
      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200',
    },
  };
  const entry = map[source] ?? map.none;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

function ImageJSection({ meta }: { meta: TiffMetadata }) {
  const ij = meta.imagej;
  if (!ij) return null;
  return (
    <Section title="ImageJ stack" icon={<Layers size={14} />}>
      <Row label="Channels" value={ij.channels ?? '-'} />
      <Row label="Slices" value={ij.slices ?? '-'} />
      <Row label="Frames" value={ij.frames ?? '-'} />
      <Row label="Hyperstack" value={ij.hyperstack ? 'yes' : 'no'} />
      <Row label="Mode" value={ij.mode ?? '-'} />
      <Row label="Spacing" value={ij.spacing != null ? `${ij.spacing} ${ij.unit ?? ''}` : '-'} />
      <Row label="Pages" value={`${meta.pageIndex + 1} / ${meta.pageCount}`} />
    </Section>
  );
}

function OmeSection({ meta }: { meta: TiffMetadata }) {
  const ome = meta.ome;
  if (!ome) return null;
  return (
    <Section title="OME-XML" icon={<Microscope size={14} />}>
      {ome.imageName && <Row label="Name" value={ome.imageName} />}
      {ome.acquisitionDate && <Row label="Acquired" value={ome.acquisitionDate} />}
      {ome.dimensionOrder && <Row label="Dim order" value={ome.dimensionOrder} />}
      {ome.pixelType && <Row label="Pixel type" value={ome.pixelType} />}
      {(ome.sizeX || ome.sizeY) && (
        <Row
          label="Size"
          value={`${ome.sizeX ?? '?'} x ${ome.sizeY ?? '?'}${ome.sizeZ ? ` x ${ome.sizeZ}Z` : ''}${ome.sizeC ? ` x ${ome.sizeC}C` : ''}${ome.sizeT ? ` x ${ome.sizeT}T` : ''}`}
        />
      )}
      {ome.physicalSizeX && (
        <Row
          label="Physical px"
          value={`${formatNumber(ome.physicalSizeX)} x ${formatNumber(ome.physicalSizeY ?? ome.physicalSizeX)} ${ome.physicalSizeXUnit ?? 'um'}`}
        />
      )}
      {ome.timeIncrement != null && (
        <Row
          label="Time step"
          value={`${formatNumber(ome.timeIncrement)} ${ome.timeIncrementUnit ?? 's'}`}
        />
      )}
      {ome.channels.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Channels ({ome.channels.length})
          </div>
          {ome.channels.map((c) => (
            <ChannelChip key={c.index} channel={c} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ChannelChip({ channel }: { channel: OmeChannelInfo }) {
  const swatch = channel.color || channelDefaultColor(channel);
  const labelParts: string[] = [];
  if (channel.excitationNm != null) labelParts.push(`ex ${channel.excitationNm}nm`);
  if (channel.emissionNm != null) labelParts.push(`em ${channel.emissionNm}nm`);
  if (channel.fluor) labelParts.push(channel.fluor);
  const sub = labelParts.join(' - ');
  return (
    <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900">
      <span
        className="h-3 w-3 rounded-sm border border-slate-300 dark:border-slate-700"
        style={{ backgroundColor: swatch }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-800 dark:text-slate-200">
          {channel.name || `Channel ${channel.index + 1}`}
        </div>
        {sub && (
          <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{sub}</div>
        )}
      </div>
    </div>
  );
}

function channelDefaultColor(c: OmeChannelInfo): string {
  if (c.emissionNm == null) return '#94a3b8';
  const nm = c.emissionNm;
  if (nm < 450) return '#3b82f6';
  if (nm < 500) return '#06b6d4';
  if (nm < 570) return '#22c55e';
  if (nm < 600) return '#eab308';
  if (nm < 650) return '#f97316';
  return '#ef4444';
}

function CaptureSection({ meta }: { meta: TiffMetadata }) {
  const has =
    meta.software ||
    meta.dateTime ||
    meta.make ||
    meta.model ||
    meta.artist ||
    meta.copyright ||
    meta.hostComputer;
  if (!has) return null;
  return (
    <Section title="Capture" icon={<Info size={14} />}>
      {meta.software && <Row label="Software" value={meta.software} />}
      {meta.dateTime && <Row label="Date / time" value={meta.dateTime} />}
      {meta.make && <Row label="Make" value={meta.make} />}
      {meta.model && <Row label="Model" value={meta.model} />}
      {meta.artist && <Row label="Artist" value={meta.artist} />}
      {meta.copyright && <Row label="Copyright" value={meta.copyright} />}
      {meta.hostComputer && <Row label="Host" value={meta.hostComputer} />}
      {meta.orientation != null && <Row label="Orientation" value={meta.orientation} />}
    </Section>
  );
}

function RawDescription({
  text,
  kind,
}: {
  text: string;
  kind: TiffMetadata['descriptionKind'];
}) {
  const formatted = useMemo(() => {
    if (kind === 'ome') return prettyXml(text);
    return text;
  }, [text, kind]);
  return (
    <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
      {formatted}
    </pre>
  );
}

function prettyXml(xml: string): string {
  const trimmed = xml.trim();
  if (typeof DOMParser === 'undefined') return trimmed;
  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return trimmed;
    return formatXmlNode(doc.documentElement, 0);
  } catch {
    return trimmed;
  }
}

function formatXmlNode(node: Element, depth: number): string {
  const indent = '  '.repeat(depth);
  const attrs = Array.from(node.attributes)
    .map((a) => ` ${a.name}="${a.value}"`)
    .join('');
  const children = Array.from(node.children);
  if (children.length === 0) {
    const text = node.textContent?.trim();
    if (!text) return `${indent}<${node.tagName}${attrs}/>`;
    return `${indent}<${node.tagName}${attrs}>${text}</${node.tagName}>`;
  }
  const inner = children.map((c) => formatXmlNode(c, depth + 1)).join('\n');
  return `${indent}<${node.tagName}${attrs}>\n${inner}\n${indent}</${node.tagName}>`;
}

function RawTagTable({ tags }: { tags: RawTiffTag[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-800">
      <table className="w-full table-fixed text-[11px]">
        <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th className="w-16 px-2 py-1">Tag</th>
            <th className="w-32 px-2 py-1">Name</th>
            <th className="px-2 py-1">Value</th>
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-300">
          {tags.map((t) => (
            <tr key={t.tag} className="border-t border-slate-200 dark:border-slate-800">
              <td className="px-2 py-1 font-mono text-slate-500 dark:text-slate-400">{t.tag}</td>
              <td className="truncate px-2 py-1">{t.name ?? '-'}</td>
              <td className="break-words px-2 py-1 font-mono">{t.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 10000 || abs < 0.001) return n.toExponential(3);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(abs >= 100 ? 2 : abs >= 1 ? 4 : 6).replace(/\.?0+$/, '');
}
