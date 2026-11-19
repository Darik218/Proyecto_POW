<script setup lang="ts">
// Abstract group monogram: no anatomical precision or muscle activation is implied.
defineProps<{ group: string }>();
</script>
<template>
  <span class="muscle-mark" aria-hidden="true"
    ><svg viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="16" r="7" />
      <path
        d="m24 29 16-5 16 5 9 23M24 29l-9 23m16-18 2 19-9 23m25-42-2 19 9 23M33 53h14"
      />
      <path d="M28 36h24M34 42h12" class="muscle-mark__accent" /></svg
    ><span>{{ group.slice(0, 2).toUpperCase() }}</span></span
  >
</template>
<style scoped>
.muscle-mark {
  display: inline-flex;
  position: relative;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 84px;
  color: var(--color-primary);
}
svg {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.muscle-mark__accent {
  stroke: var(--color-secondary);
}
.muscle-mark > span {
  position: absolute;
  right: -4px;
  bottom: 0;
  font-size: 10px;
  font-weight: 800;
  background: var(--color-surface-elevated);
  padding: 2px 5px;
  border-radius: 4px;
}
</style>
