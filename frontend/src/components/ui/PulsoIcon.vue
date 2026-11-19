<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(defineProps<{ name: string; size?: number }>(), {
  size: 20,
});
const paths: Record<string, string[]> = {
  home: ["m3 10 9-7 9 7", "M5 9v12h5v-7h4v7h5V9"],
  activity: ["M2 12h4l3-8 5 16 3-8h5"],
  calendar: [
    "M8 2v4m8-4v4",
    "M3 10h18",
    "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    "M7 14h2m4 0h2m-8 4h2",
  ],
  chart: ["M4 3v17h17", "m7 14 4-5 4 3 6-8"],
  dumbbell: ["M6 5v14m12-14v14M3 8v8m18-8v8M6 12h12"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "m9 3 1-2h4l1 2 2 1 2-.2 2 3-1 2v3l1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1-2V9L2 7l2-3 2 .2Z",
  ],
  shield: ["M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z", "m8 12 3 3 5-6"],
  user: ["M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M4 21v-2a8 8 0 0 1 16 0v2"],
  "arrow-right": ["M4 12h16", "m14 6 6 6-6 6"],
  check: ["m5 12 4 4L19 6"],
  plus: ["M12 5v14M5 12h14"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7v5l3 2"],
  history: ["M3 11a9 9 0 1 1 1 6", "M3 4v7h7", "M12 7v5l3 2"],
  close: ["m6 6 12 12M6 18 18 6"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  "chevron-right": ["m9 5 7 7-7 7"],
  layers: ["m12 2 10 6-10 6L2 8Z", "m2 12 10 6 10-6", "m2 16 10 6 10-6"],
  search: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m15 15 6 6"],
  logout: ["M9 4H4v16h5", "M10 12h11", "m17 8 4 4-4 4"],
  scale: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M7 8a6 6 0 0 1 10 0l-5 4Z",
  ],
  bolt: ["m13 2-9 12h7l-1 8 10-12h-7Z"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 11v6m0-10v.1"],
};
const strokes = computed(() => paths[props.name] ?? paths.activity);
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="pulso-icon"
  >
    <path v-for="(path, index) in strokes" :key="index" :d="path" />
  </svg>
</template>
