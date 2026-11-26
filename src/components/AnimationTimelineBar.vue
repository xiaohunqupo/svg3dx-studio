<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BackwardIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "tdesign-icons-vue-next";
import { type DropdownOption } from "tdesign-vue-next";
import {
  parseDurationSecs,
  parseRepeat,
  type AnimationDesc,
  type EmbedViewer,
} from "svg3dx-viewer";
import { useI18n } from "@/i18n";
import {
  listAnimTimelineEntries,
  type AnimTimelineEntry,
} from "@/utils/animTimelineEntries";
import { formatDurationSecs } from "@/utils/animTimingFormat";

const props = defineProps<{
  /** Live embed viewer (Browse ViewerHost / Edit InteractHost). */
  viewer?: EmbedViewer | null;
  /**
   * Prefer a getter when the host creates the viewer asynchronously —
   * a static `viewer` ref may stay null after mount.
   */
  getViewer?: () => EmbedViewer | null | undefined;
  /** Current document XML — labels / paths follow edits immediately. */
  content?: string;
  /** Tree selection path — highlights the matching track row. */
  selectedPath?: string | null;
}>();

const { t } = useI18n();

const MIN_DUR_SECS = 0.001;

type TrackRow = {
  key: string;
  /** Studio tree path for selection linkage. */
  path: string;
  /** Animation element id (left); empty when unset. */
  primary: string;
  /** Attribute name / transform type (right). */
  secondary: string;
  kind: "param" | "transform";
  begin: number;
  end: number;
  /** Play cycles used for end = begin + dur * cycles. */
  cycles: number;
  loop: boolean;
  from: string;
  to: string;
};

type KeyDragState = {
  which: "begin" | "end";
  trackKey: string;
  path: string;
  begin: number;
  end: number;
  cycles: number;
  /** Frozen scale so dragging past the right edge can extend the axis. */
  pxPerSec: number;
};

const emit = defineEmits<{
  hide: [];
  selectPath: [path: string];
  nodeAttrsChange: [payload: { path: string; updates: Record<string, string> }];
}>();

const hasAnim = ref(false);

const moreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.hide"),
    value: "hide",
  },
]);

function onMoreClick(item: DropdownOption): void {
  if (item.value === "hide") emit("hide");
}

const playing = ref(false);
const time = ref(0);
/** Visible time-axis length (grows/shrinks with key drags). */
const duration = ref(1);
const tracks = ref<TrackRow[]>([]);
const scrubbing = ref(false);
const keyDrag = ref<KeyDragState | null>(null);
/**
 * Horizontal zoom: 1× = 100px per second.
 * Default is 1× (already a comfortable scale); zoom out goes below 100px/s.
 */
const PX_PER_SEC_1X = 100;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_DEFAULT = 1;
const ZOOM_STEP = 1.25;
const zoom = ref(ZOOM_DEFAULT);
/** Local begin/end after key commit, until `content` catches up. */
const pendingTiming = ref<Map<string, { begin: number; end: number }>>(
  new Map()
);
const labelsEl = ref<HTMLElement | null>(null);
const timelineEl = ref<HTMLElement | null>(null);
const timelineInnerEl = ref<HTMLElement | null>(null);
/** Right gutter so the end tick label stays visible without clipping. */
const END_GUTTER_PX = 44;
/** Scrub snap radii in CSS pixels (major ticks / keys a bit stickier). */
const SNAP_MINOR_PX = 6;
const SNAP_MAJOR_PX = 10;
const SNAP_KEY_PX = 12;
let raf = 0;
let syncingScroll = false;

const canZoomIn = computed(() => zoom.value < ZOOM_MAX - 1e-6);
const canZoomOut = computed(() => zoom.value > ZOOM_MIN + 1e-6);
/** Effective pixels-per-second at the current zoom. */
const pxPerSec = computed(() => PX_PER_SEC_1X * zoom.value);

const timelineInnerStyle = computed(() => {
  const pps = keyDrag.value?.pxPerSec ?? pxPerSec.value;
  const timedPx = Math.max(0, duration.value) * pps;
  const portW = timelineEl.value?.clientWidth ?? 0;
  return {
    "--anim-end-gutter": `${END_GUTTER_PX}px`,
    width: `${Math.max(timedPx + END_GUTTER_PX, portW)}px`,
  };
});

function timeToLeftPx(secs: number, pps = pxPerSec.value): string {
  return `${Math.max(0, secs) * pps}px`;
}

function timeToWidthPx(secs: number, pps = pxPerSec.value): string {
  return `${Math.max(1, secs * pps)}px`;
}

const timeLabel = computed(() => formatTime(time.value));
const durationLabel = computed(() => formatTime(duration.value));
const playheadStyle = computed(() => ({
  left: timeToLeftPx(time.value),
}));

const rulerTicks = computed(() => {
  const d = duration.value;
  if (d <= 0) return [] as { t: number; major: boolean }[];
  const step = niceStep(d);
  const out: { t: number; major: boolean }[] = [];
  for (let t0 = 0; t0 <= d + 1e-6; t0 += step / 2) {
    const t = Math.min(d, Math.round(t0 * 1000) / 1000);
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    out.push({ t, major });
    if (t >= d) break;
  }
  return out;
});

/** Snap candidates: ruler ticks + track keyframes (begin/end). */
const snapTargets = computed(() => {
  const out: { t: number; radiusPx: number }[] = [];
  for (const tick of rulerTicks.value) {
    out.push({
      t: tick.t,
      radiusPx: tick.major ? SNAP_MAJOR_PX : SNAP_MINOR_PX,
    });
  }
  for (const row of tracks.value) {
    out.push({ t: row.begin, radiusPx: SNAP_KEY_PX });
    out.push({ t: row.end, radiusPx: SNAP_KEY_PX });
  }
  return out;
});

function formatTime(secs: number): string {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rem.toFixed(2).padStart(5, "0")}`;
}

function niceStep(d: number): number {
  if (d <= 1) return 0.25;
  if (d <= 2) return 0.5;
  if (d <= 5) return 1;
  if (d <= 15) return 2;
  if (d <= 30) return 5;
  return 10;
}

function resolveViewer(): EmbedViewer | null {
  return props.getViewer?.() ?? props.viewer ?? null;
}

function trackTitle(row: TrackRow): string {
  if (row.primary && row.secondary) return `${row.primary} · ${row.secondary}`;
  return row.primary || row.secondary || "";
}

function matchEntry(
  desc: AnimationDesc,
  entries: AnimTimelineEntry[],
  used: Set<number>
): AnimTimelineEntry | null {
  const animId = desc.id?.trim() || "";
  if (animId) {
    const i = entries.findIndex(
      (e, idx) => !used.has(idx) && e.id === animId
    );
    if (i >= 0) {
      used.add(i);
      return entries[i]!;
    }
  }
  const wantKind = desc.kind === "param" ? "animate" : "animateTransform";
  const wantHint =
    desc.kind === "param"
      ? desc.attribute_name.replace(/^--/, "")
      : desc.transform_type;
  const wantParent = desc.parent_id?.trim() || null;
  const i = entries.findIndex((e, idx) => {
    if (used.has(idx) || e.kind !== wantKind) return false;
    if (e.hint !== wantHint) return false;
    if (wantParent && e.parentId && e.parentId !== wantParent) return false;
    return true;
  });
  if (i >= 0) {
    used.add(i);
    return entries[i]!;
  }
  return null;
}

function descToTrack(
  desc: AnimationDesc,
  index: number,
  entry: AnimTimelineEntry | null
): TrackRow {
  const begin = desc.timing.begin
    ? (parseDurationSecs(desc.timing.begin) ?? 0)
    : 0;
  const dur = parseDurationSecs(desc.timing.dur) ?? 0;
  const { indefinite: loop, count } = parseRepeat(desc.timing.repeat);
  const cycles = loop ? 1 : Math.max(1, count);
  const primary = (entry?.id || desc.id?.trim() || "").trim();
  const secondary =
    entry?.hint ||
    (desc.kind === "param"
      ? desc.attribute_name.replace(/^--/, "")
      : desc.transform_type);
  return {
    key: entry?.path || `${desc.kind}:${index}:${desc.attribute_name}`,
    path: entry?.path || "",
    primary,
    secondary,
    kind: desc.kind,
    begin,
    end: begin + dur * cycles,
    cycles,
    loop,
    from: desc.timing.from,
    to: desc.timing.to,
  };
}

/** Axis length = longest track end (and viewer duration as a floor). */
function axisDurationFrom(rows: TrackRow[]): number {
  let max = 0.01;
  const v = resolveViewer();
  if (v?.hasDocumentAnimations()) {
    max = Math.max(max, v.getAnimationDuration());
  }
  for (const row of rows) max = Math.max(max, row.end);
  if (keyDrag.value) max = Math.max(max, keyDrag.value.end);
  return max;
}

function refreshAxisDuration(rows: TrackRow[] = tracks.value): void {
  duration.value = axisDurationFrom(rows);
}

function syncFromViewer(): void {
  const v = resolveViewer();
  if (!v) {
    hasAnim.value = false;
    playing.value = false;
    time.value = 0;
    duration.value = 1;
    tracks.value = [];
    return;
  }
  hasAnim.value = v.hasDocumentAnimations();
  if (!hasAnim.value) {
    playing.value = false;
    tracks.value = [];
    return;
  }
  playing.value = v.getAnimationPlaying();
  if (!scrubbing.value) {
    // Composition time 0 → end; delayed clips simply idle until their begin.
    time.value = v.getAnimationScrubberTime();
  }
  // Keep local begin/end while dragging keys — avoid eval overwrite mid-drag.
  if (keyDrag.value) {
    refreshAxisDuration();
    return;
  }
  const descs = (v.getResult()?.animations ?? []) as AnimationDesc[];
  const entries = listAnimTimelineEntries(props.content ?? "");
  const used = new Set<number>();
  const pending = pendingTiming.value;
  const next = descs.map((desc, index) => {
    const row = descToTrack(desc, index, matchEntry(desc, entries, used));
    const hold = pending.get(row.path) ?? pending.get(row.key);
    return hold ? { ...row, begin: hold.begin, end: hold.end } : row;
  });
  tracks.value = next;
  refreshAxisDuration(next);
}

function onTrackSelect(row: TrackRow): void {
  if (!row.path) return;
  emit("selectPath", row.path);
}

function tick(): void {
  raf = 0;
  syncFromViewer();
  raf = requestAnimationFrame(tick);
}

onMounted(() => {
  syncFromViewer();
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointermove", onKeyPointerMove);
  window.removeEventListener("pointerup", onKeyPointerUp);
});

watch(
  () => props.content,
  () => {
    pendingTiming.value.clear();
  }
);

watch(
  () => [props.viewer, props.getViewer, props.content],
  () => syncFromViewer()
);

function seekTo(secs: number): void {
  const v = resolveViewer();
  if (!v || !hasAnim.value) return;
  const next = Math.min(duration.value, Math.max(0, secs));
  time.value = next;
  if (v.getAnimationPlaying()) v.setAnimationPlaying(false);
  v.setAnimationTime(next);
}

function togglePlay(): void {
  const v = resolveViewer();
  if (!v || !hasAnim.value) return;
  v.setAnimationPlaying(!v.getAnimationPlaying());
  syncFromViewer();
}

function onStop(): void {
  const v = resolveViewer();
  if (!v || !hasAnim.value) return;
  v.setAnimationPlaying(false);
  v.resetAnimationClock();
  syncFromViewer();
}

function onToStart(): void {
  seekTo(0);
  syncFromViewer();
}

function currentPxPerSec(): number {
  return keyDrag.value?.pxPerSec || pxPerSec.value;
}

function timeFromClientX(clientX: number): number {
  const el = timelineInnerEl.value ?? timelineEl.value;
  if (!el) return time.value;
  const rect = el.getBoundingClientRect();
  const pps = currentPxPerSec();
  if (pps <= 0) return 0;
  const x = Math.max(0, clientX - rect.left);
  const timedW = duration.value * pps;
  return Math.min(duration.value, x > timedW ? duration.value : x / pps);
}

/** Snap scrub time to nearby ticks / keys. Hold Ctrl/Cmd to bypass. */
function snapScrubTime(raw: number, bypass: boolean): number {
  if (bypass) return raw;
  const pps = currentPxPerSec();
  if (pps <= 0) return raw;

  let best = raw;
  let bestDistPx = Infinity;
  for (const { t, radiusPx } of snapTargets.value) {
    const distPx = Math.abs(t - raw) * pps;
    if (distPx <= radiusPx && distPx < bestDistPx) {
      bestDistPx = distPx;
      best = t;
    }
  }
  return best;
}

function scrubFromClientX(clientX: number, bypassSnap: boolean): void {
  seekTo(snapScrubTime(timeFromClientX(clientX), bypassSnap));
}

function onLabelsScroll(): void {
  if (syncingScroll) return;
  const labels = labelsEl.value;
  const timeline = timelineEl.value;
  if (!labels || !timeline) return;
  syncingScroll = true;
  timeline.scrollTop = labels.scrollTop;
  syncingScroll = false;
}

function onTimelineScroll(): void {
  if (syncingScroll) return;
  const labels = labelsEl.value;
  const timeline = timelineEl.value;
  if (!labels || !timeline) return;
  syncingScroll = true;
  labels.scrollTop = timeline.scrollTop;
  syncingScroll = false;
}

function bypassSnap(e: PointerEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/** Track area: click jumps playhead (no drag — keys stay grabbable). */
function onTimelinePointerDown(e: PointerEvent): void {
  if (e.button !== 0 || scrubbing.value || keyDrag.value) return;
  scrubFromClientX(e.clientX, bypassSnap(e));
}

/** Top ruler / playhead head: jump to click and scrub in one gesture. */
function startScrubDrag(e: PointerEvent): void {
  if (e.button !== 0 || keyDrag.value) return;
  e.preventDefault();
  e.stopPropagation();
  scrubbing.value = true;
  scrubFromClientX(e.clientX, bypassSnap(e));
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onRulerPointerDown(e: PointerEvent): void {
  startScrubDrag(e);
}

function onPlayheadPointerDown(e: PointerEvent): void {
  startScrubDrag(e);
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!scrubbing.value) return;
  scrubFromClientX(e.clientX, bypassSnap(e));
}

function onWindowPointerUp(): void {
  scrubbing.value = false;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  syncFromViewer();
}

function ensureTimeVisible(secs: number): void {
  const port = timelineEl.value;
  if (!port) return;
  const x = Math.max(0, secs) * currentPxPerSec();
  const viewL = port.scrollLeft;
  const viewR = viewL + port.clientWidth;
  const pad = 32;
  if (x > viewR - pad - END_GUTTER_PX) {
    port.scrollLeft = x - port.clientWidth + pad + END_GUTTER_PX;
  } else if (x < viewL + pad) {
    port.scrollLeft = Math.max(0, x - pad);
  }
}

function timeFromKeyDragX(clientX: number): number {
  const drag = keyDrag.value;
  const el = timelineInnerEl.value ?? timelineEl.value;
  if (!drag || !el || drag.pxPerSec <= 0) {
    return timeFromClientX(clientX);
  }
  const rect = el.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left) / drag.pxPerSec);
}

function applyKeyDragLocal(which: "begin" | "end", tRaw: number): void {
  const drag = keyDrag.value;
  if (!drag) return;
  const cycles = Math.max(1, drag.cycles);
  const minSpan = MIN_DUR_SECS * cycles;
  let begin = drag.begin;
  let end = drag.end;
  if (which === "begin") {
    begin = Math.min(tRaw, end - minSpan);
    begin = Math.max(0, begin);
  } else {
    // Allow dragging past the current axis — axis grows with the end key.
    end = Math.max(tRaw, begin + minSpan);
  }
  drag.begin = begin;
  drag.end = end;
  const i = tracks.value.findIndex((r) => r.key === drag.trackKey);
  if (i >= 0) {
    const row = tracks.value[i]!;
    tracks.value[i] = { ...row, begin, end };
  }
  // Grow when dragging right; shrink when dragging left / shortening.
  refreshAxisDuration();
  ensureTimeVisible(which === "begin" ? begin : end);
  seekTo(which === "begin" ? begin : end);
}

function onZoomIn(): void {
  zoom.value = Math.min(
    ZOOM_MAX,
    Math.round(zoom.value * ZOOM_STEP * 1000) / 1000
  );
}

function onZoomOut(): void {
  zoom.value = Math.max(
    ZOOM_MIN,
    Math.round((zoom.value / ZOOM_STEP) * 1000) / 1000
  );
}

function onKeyPointerDown(
  row: TrackRow,
  which: "begin" | "end",
  e: PointerEvent
): void {
  if (e.button !== 0 || !row.path || scrubbing.value) return;
  e.preventDefault();
  e.stopPropagation();
  onTrackSelect(row);
  keyDrag.value = {
    which,
    trackKey: row.key,
    path: row.path,
    begin: row.begin,
    end: row.end,
    cycles: Math.max(1, row.cycles),
    pxPerSec: pxPerSec.value,
  };
  const raw =
    which === "end"
      ? timeFromKeyDragX(e.clientX)
      : timeFromClientX(e.clientX);
  applyKeyDragLocal(which, snapScrubTime(raw, bypassSnap(e)));
  window.addEventListener("pointermove", onKeyPointerMove);
  window.addEventListener("pointerup", onKeyPointerUp);
}

function onKeyPointerMove(e: PointerEvent): void {
  const drag = keyDrag.value;
  if (!drag) return;
  const raw =
    drag.which === "end"
      ? timeFromKeyDragX(e.clientX)
      : timeFromClientX(e.clientX);
  applyKeyDragLocal(drag.which, snapScrubTime(raw, bypassSnap(e)));
}

function onKeyPointerUp(): void {
  const drag = keyDrag.value;
  window.removeEventListener("pointermove", onKeyPointerMove);
  window.removeEventListener("pointerup", onKeyPointerUp);
  keyDrag.value = null;
  if (!drag?.path) {
    syncFromViewer();
    return;
  }
  const cycles = Math.max(1, drag.cycles);
  const durSecs = Math.max(MIN_DUR_SECS, (drag.end - drag.begin) / cycles);
  const updates: Record<string, string> = {
    dur: formatDurationSecs(durSecs),
    // Omit begin when ~0 so XML stays tidy (same as typical authored docs).
    begin: drag.begin <= 1e-6 ? "" : formatDurationSecs(drag.begin),
  };
  pendingTiming.value.set(drag.path, {
    begin: drag.begin,
    end: drag.end,
  });
  // Keep local track times until parent `content` refreshes after the write.
  emit("nodeAttrsChange", { path: drag.path, updates });
}

function spanStyle(row: TrackRow): Record<string, string> {
  return {
    left: timeToLeftPx(row.begin),
    width: timeToWidthPx(Math.max(MIN_DUR_SECS, row.end - row.begin)),
  };
}

function keyStyle(secs: number): Record<string, string> {
  return { left: timeToLeftPx(secs) };
}

function tickStyle(secs: number): Record<string, string> {
  return { left: timeToLeftPx(secs) };
}
</script>

<template>
  <div
    v-if="hasAnim"
    class="anim-editor"
    :class="{
      'is-scrubbing': scrubbing,
      'is-key-dragging': !!keyDrag,
    }"
    role="region"
    :aria-label="t('app.animEditor')"
  >
    <div class="anim-toolbar">
      <div class="anim-transport">
        <t-button
          size="small"
          variant="text"
          shape="square"
          :title="t('app.animToStart')"
          @click="onToStart"
        >
          <template #icon><BackwardIcon /></template>
        </t-button>
        <t-button
          size="small"
          variant="text"
          shape="square"
          :title="playing ? t('app.animPause') : t('app.animPlay')"
          @click="togglePlay"
        >
          <template #icon>
            <PauseIcon v-if="playing" />
            <PlayIcon v-else />
          </template>
        </t-button>
        <t-button
          size="small"
          variant="text"
          shape="square"
          :title="t('app.animStop')"
          @click="onStop"
        >
          <template #icon><StopIcon /></template>
        </t-button>
      </div>
      <div class="anim-timeblock" :title="t('app.animTime')">
        <span class="anim-time-cur">{{ timeLabel }}</span>
        <span class="anim-time-sep">/</span>
        <span class="anim-time-dur">{{ durationLabel }}</span>
      </div>
      <span class="anim-toolbar-gap" />
      <span class="anim-track-count">
        {{ t("app.animTracks", { n: tracks.length }) }}
      </span>
      <div class="anim-zoom">
        <t-button
          size="small"
          variant="text"
          shape="square"
          :disabled="!canZoomOut"
          :title="t('app.animZoomOut')"
          :aria-label="t('app.animZoomOut')"
          @click="onZoomOut"
        >
          <template #icon><ZoomOutIcon /></template>
        </t-button>
        <t-button
          size="small"
          variant="text"
          shape="square"
          :disabled="!canZoomIn"
          :title="t('app.animZoomIn')"
          :aria-label="t('app.animZoomIn')"
          @click="onZoomIn"
        >
          <template #icon><ZoomInIcon /></template>
        </t-button>
      </div>
      <t-dropdown
        :options="moreOptions"
        :max-column-width="200"
        :min-column-width="120"
        trigger="click"
        placement="bottom-right"
        @click="onMoreClick"
      >
        <t-button
          class="anim-more"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.moreActions')"
          :aria-label="t('app.moreActions')"
        >
          <template #icon><MoreIcon /></template>
        </t-button>
      </t-dropdown>
    </div>

    <div class="anim-body">
      <div
        ref="labelsEl"
        class="anim-labels"
        @scroll="onLabelsScroll"
      >
        <div class="anim-label-head">{{ t("app.animTrack") }}</div>
        <div
          v-for="row in tracks"
          :key="row.key"
          class="anim-label-row"
          :class="{ active: row.path && row.path === selectedPath }"
          :title="trackTitle(row)"
          role="button"
          tabindex="0"
          @click.stop="onTrackSelect(row)"
          @keydown.enter.prevent="onTrackSelect(row)"
        >
          <span class="anim-kind" :data-kind="row.kind">{{
            row.kind === "param" ? "P" : "T"
          }}</span>
          <span class="anim-label-text">
            <span class="anim-label-id">{{ row.primary }}</span>
            <span v-if="row.secondary" class="anim-label-attr">{{
              row.secondary
            }}</span>
          </span>
          <span v-if="row.loop" class="anim-loop" :title="t('app.animLoop')"
            >∞</span
          >
        </div>
      </div>

      <div
        ref="timelineEl"
        class="anim-timeline"
        @scroll="onTimelineScroll"
        @pointerdown="onTimelinePointerDown"
      >
        <div
          ref="timelineInnerEl"
          class="anim-timeline-inner"
          :style="timelineInnerStyle"
        >
          <!-- Same positions as ruler ticks — keeps grid aligned with labels. -->
          <div class="anim-grid" aria-hidden="true">
            <span
              v-for="(tick, i) in rulerTicks"
              :key="`g-${i}`"
              class="anim-grid-line"
              :class="{ major: tick.major }"
              :style="tickStyle(tick.t)"
            />
          </div>

          <div class="anim-ruler" @pointerdown="onRulerPointerDown">
            <span
              v-for="(tick, i) in rulerTicks"
              :key="i"
              class="anim-tick"
              :class="{ major: tick.major }"
              :style="tickStyle(tick.t)"
            >
              <span v-if="tick.major" class="anim-tick-label">{{
                formatTime(tick.t)
              }}</span>
            </span>
          </div>

          <div
            v-for="row in tracks"
            :key="row.key"
            class="anim-track-row"
          >
            <div class="anim-span" :style="spanStyle(row)" />
            <span
              class="anim-key anim-key--begin"
              :class="{
                dragging:
                  keyDrag?.trackKey === row.key && keyDrag.which === 'begin',
              }"
              :style="keyStyle(row.begin)"
              :title="`${formatTime(row.begin)} · from ${row.from}`"
              @pointerdown="onKeyPointerDown(row, 'begin', $event)"
            />
            <span
              class="anim-key anim-key--end"
              :class="{
                dragging:
                  keyDrag?.trackKey === row.key && keyDrag.which === 'end',
              }"
              :style="keyStyle(row.end)"
              :title="`${formatTime(row.end)} · to ${row.to}`"
              @pointerdown="onKeyPointerDown(row, 'end', $event)"
            />
          </div>

          <div
            class="anim-playhead"
            :class="{ scrubbing }"
            :style="playheadStyle"
            aria-hidden="true"
          >
            <!-- Hit only the top head so the red stem does not steal keyframe drags. -->
            <div
              class="anim-playhead-handle"
              role="slider"
              :aria-valuemin="0"
              :aria-valuemax="duration"
              :aria-valuenow="time"
              :aria-label="t('app.animTime')"
              @pointerdown="onPlayheadPointerDown"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.anim-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 220px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  box-shadow: var(--td-shadow-1);
  pointer-events: auto;
  overflow: hidden;
  font-size: 12px;
  color: var(--td-text-color-primary);
  user-select: none;
}
.anim-editor.is-scrubbing,
.anim-editor.is-scrubbing *,
.anim-editor.is-key-dragging,
.anim-editor.is-key-dragging * {
  cursor: ew-resize !important;
}

.anim-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  min-height: 32px;
  border-bottom: 1px solid var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
  flex-shrink: 0;
}

.anim-transport {
  display: flex;
  align-items: center;
  gap: 2px;
}

.anim-timeblock {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 0 6px;
  border-left: 1px solid var(--td-component-border);
  border-right: 1px solid var(--td-component-border);
  margin-left: 4px;
}

.anim-time-cur {
  color: var(--td-brand-color);
  font-weight: 600;
}
.anim-time-sep {
  color: var(--td-text-color-placeholder);
}
.anim-time-dur {
  color: var(--td-text-color-secondary);
}

.anim-toolbar-gap {
  flex: 1;
}

.anim-track-count {
  color: var(--td-text-color-secondary);
  white-space: nowrap;
  margin-right: 4px;
}

.anim-zoom {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  margin-right: 2px;
  color: var(--td-text-color-secondary);
}

.anim-more {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.anim-body {
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.anim-labels {
  border-right: 1px solid var(--td-component-border);
  overflow: auto;
  background: var(--td-bg-color-container);
  /* Keep row boxes flush with the timeline; scroll via synced wheel/drag. */
  scrollbar-width: none;
}
.anim-labels::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.anim-label-head,
.anim-ruler {
  height: 22px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.anim-label-head {
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: var(--td-text-color-secondary);
  font-weight: 600;
}

.anim-label-row,
.anim-track-row {
  position: relative;
  height: 28px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--td-component-stroke);
  z-index: 1;
}

.anim-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  min-width: 0;
}
.anim-label-row:hover {
  background: var(--td-bg-color-container-hover);
}
.anim-label-row.active {
  background: var(--td-brand-color-light);
}

.anim-kind {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--td-brand-color);
}
.anim-kind[data-kind="transform"] {
  background: var(--td-warning-color, #e37318);
}

.anim-label-text {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  line-height: 1.2;
}

.anim-label-id,
.anim-label-attr {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anim-label-id {
  flex: 1;
  min-width: 0;
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.anim-label-attr {
  flex-shrink: 0;
  max-width: 45%;
  margin-left: auto;
  text-align: right;
  color: var(--td-text-color-secondary);
  font-size: 11px;
  font-weight: 400;
}

.anim-loop {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
  font-size: 13px;
  line-height: 1;
}

.anim-timeline {
  position: relative;
  overflow: auto;
  background-color: var(--td-bg-color-page);
}

.anim-timeline-inner {
  --anim-end-gutter: 44px;
  position: relative;
  box-sizing: border-box;
  min-height: 100%;
}

.anim-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.anim-grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px solid var(--td-component-stroke);
  transform: translateX(-0.5px);
  opacity: 0.55;
}
.anim-grid-line.major {
  border-left-color: var(--td-component-border);
  opacity: 0.9;
}

.anim-ruler {
  position: relative;
  width: 100%;
  z-index: 1;
  touch-action: none;
}

.anim-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  transform: translateX(-0.5px);
}
.anim-tick-label {
  position: absolute;
  top: 2px;
  left: 3px;
  font-size: 10px;
  color: var(--td-text-color-placeholder);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.anim-span {
  position: absolute;
  top: 8px;
  height: 12px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--td-brand-color) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--td-brand-color) 70%, transparent);
  box-sizing: border-box;
  pointer-events: none;
}

.anim-key {
  position: absolute;
  top: 50%;
  box-sizing: border-box;
  pointer-events: auto;
  cursor: ew-resize;
  touch-action: none;
  z-index: 3;
}
/* Start key — filled diamond. */
.anim-key--begin {
  width: 12px;
  height: 12px;
  margin-left: -6px;
  margin-top: -6px;
  background: var(--td-brand-color);
  border: 1px solid var(--td-bg-color-container);
  transform: rotate(45deg);
}
/* End key — hollow upright square (distinct from start). */
.anim-key--end {
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  margin-top: -5.5px;
  background: var(--td-bg-color-container);
  border: 2px solid var(--td-warning-color, #e37318);
  border-radius: 2px;
  transform: none;
}
.anim-key--begin.dragging {
  background: var(--td-brand-color-active, var(--td-brand-color));
  z-index: 5;
}
.anim-key--end.dragging {
  background: color-mix(
    in srgb,
    var(--td-warning-color, #e37318) 35%,
    var(--td-bg-color-container)
  );
  z-index: 5;
}

.anim-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 2;
}
/* Visible stem — not interactive (keys sit above it). */
.anim-playhead::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  transform: translateX(-50%);
  background: var(--td-error-color, #d54941);
  pointer-events: none;
}
.anim-playhead-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 14px;
  height: 16px;
  transform: translateX(-50%);
  pointer-events: auto;
  cursor: ew-resize;
  touch-action: none;
  z-index: 4;
}
.anim-playhead-handle::before {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 7px solid var(--td-error-color, #d54941);
  pointer-events: none;
}
</style>
