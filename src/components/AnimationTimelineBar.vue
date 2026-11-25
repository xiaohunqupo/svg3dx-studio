<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BackwardIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "tdesign-icons-vue-next";
import { type DropdownOption } from "tdesign-vue-next";
import {
  parseDurationSecs,
  parseRepeat,
  type AnimationDesc,
  type EmbedViewer,
} from "svg3dx-viewer";
import { useI18n } from "@/i18n";

const props = defineProps<{
  /** Live embed viewer (Browse ViewerHost / Edit InteractHost). */
  viewer?: EmbedViewer | null;
  /**
   * Prefer a getter when the host creates the viewer asynchronously —
   * a static `viewer` ref may stay null after mount.
   */
  getViewer?: () => EmbedViewer | null | undefined;
}>();

const { t } = useI18n();

type TrackRow = {
  key: string;
  label: string;
  kind: "param" | "transform";
  begin: number;
  end: number;
  loop: boolean;
  from: string;
  to: string;
};

const emit = defineEmits<{
  hide: [];
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
const duration = ref(1);
const tracks = ref<TrackRow[]>([]);
const scrubbing = ref(false);
const timelineEl = ref<HTMLElement | null>(null);
let raf = 0;

const timeLabel = computed(() => formatTime(time.value));
const durationLabel = computed(() => formatTime(duration.value));
const playheadPct = computed(() => {
  const d = duration.value;
  if (d <= 0) return 0;
  return Math.min(100, Math.max(0, (time.value / d) * 100));
});

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

function trackLabel(desc: AnimationDesc): string {
  if (desc.kind === "param") {
    const host = desc.parent_id?.trim();
    return host ? `${host} · ${desc.attribute_name}` : desc.attribute_name;
  }
  const host = desc.parent_id?.trim() || desc.parent_tag;
  return `${host} · ${desc.transform_type}`;
}

function descToTrack(desc: AnimationDesc, index: number): TrackRow {
  const begin = desc.timing.begin
    ? (parseDurationSecs(desc.timing.begin) ?? 0)
    : 0;
  const dur = parseDurationSecs(desc.timing.dur) ?? 0;
  const { indefinite: loop, count } = parseRepeat(desc.timing.repeat);
  const cycles = loop ? 1 : Math.max(1, count);
  return {
    key: `${desc.kind}:${index}:${desc.attribute_name}`,
    label: trackLabel(desc),
    kind: desc.kind,
    begin,
    end: begin + dur * cycles,
    loop,
    from: desc.timing.from,
    to: desc.timing.to,
  };
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
  duration.value = Math.max(0.01, v.getAnimationDuration());
  if (!scrubbing.value) {
    const t0 = v.getAnimationTime();
    time.value = duration.value > 0 ? t0 % duration.value : t0;
  }
  const descs = (v.getResult()?.animations ?? []) as AnimationDesc[];
  tracks.value = descs.map(descToTrack);
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
});

watch(
  () => [props.viewer, props.getViewer],
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
  v.setAnimationTime(0);
  syncFromViewer();
}

function onToStart(): void {
  seekTo(0);
  syncFromViewer();
}

function timeFromClientX(clientX: number): number {
  const el = timelineEl.value;
  if (!el) return time.value;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
  return (x / rect.width) * duration.value;
}

function onTimelinePointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  scrubbing.value = true;
  seekTo(timeFromClientX(e.clientX));
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!scrubbing.value) return;
  seekTo(timeFromClientX(e.clientX));
}

function onWindowPointerUp(): void {
  scrubbing.value = false;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  syncFromViewer();
}

function spanStyle(row: TrackRow): Record<string, string> {
  const d = duration.value || 1;
  const left = (row.begin / d) * 100;
  const width = Math.max(0.8, ((row.end - row.begin) / d) * 100);
  return {
    left: `${left}%`,
    width: `${width}%`,
  };
}

function keyStyle(secs: number): Record<string, string> {
  const d = duration.value || 1;
  return { left: `${(secs / d) * 100}%` };
}
</script>

<template>
  <div
    v-if="hasAnim"
    class="anim-editor"
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
      <div class="anim-labels">
        <div class="anim-label-head">{{ t("app.animTrack") }}</div>
        <div
          v-for="row in tracks"
          :key="row.key"
          class="anim-label-row"
          :title="row.label"
        >
          <span class="anim-kind" :data-kind="row.kind">{{
            row.kind === "param" ? "P" : "T"
          }}</span>
          <span class="anim-label-text">{{ row.label }}</span>
          <span v-if="row.loop" class="anim-loop" :title="t('app.animLoop')"
            >∞</span
          >
        </div>
      </div>

      <div
        ref="timelineEl"
        class="anim-timeline"
        @pointerdown="onTimelinePointerDown"
      >
        <div class="anim-ruler">
          <span
            v-for="(tick, i) in rulerTicks"
            :key="i"
            class="anim-tick"
            :class="{ major: tick.major }"
            :style="{ left: `${(tick.t / duration) * 100}%` }"
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
            class="anim-key"
            :style="keyStyle(row.begin)"
            :title="`from ${row.from}`"
          />
          <span
            class="anim-key"
            :style="keyStyle(row.end)"
            :title="`to ${row.to}`"
          />
        </div>

        <div
          class="anim-playhead"
          :style="{ left: `${playheadPct}%` }"
          aria-hidden="true"
        />
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
}

.anim-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  min-width: 0;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.anim-loop {
  margin-left: auto;
  color: var(--td-text-color-secondary);
  font-size: 13px;
  line-height: 1;
}

.anim-timeline {
  position: relative;
  overflow: auto;
  cursor: ew-resize;
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent calc(10% - 1px),
      var(--td-component-stroke) calc(10% - 1px),
      var(--td-component-stroke) 10%
    );
  background-color: var(--td-bg-color-page);
}

.anim-ruler {
  position: relative;
  width: 100%;
}

.anim-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px solid var(--td-component-stroke);
  transform: translateX(-0.5px);
}
.anim-tick.major {
  border-left-color: var(--td-component-border);
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
  width: 9px;
  height: 9px;
  margin-left: -4.5px;
  margin-top: -4.5px;
  background: var(--td-brand-color);
  transform: rotate(45deg);
  border: 1px solid var(--td-bg-color-container);
  box-sizing: border-box;
  pointer-events: none;
  z-index: 1;
}

.anim-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px solid var(--td-error-color, #d54941);
  transform: translateX(-1px);
  pointer-events: none;
  z-index: 2;
}
.anim-playhead::before {
  content: "";
  position: absolute;
  top: 0;
  left: -5px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 7px solid var(--td-error-color, #d54941);
}
</style>
